import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { canUsePipeline, pipelineStateOnDecision } from "./toggles";
import { latestPipelineConsent } from "./pipeline";
import { writeAudit } from "./audit";

// The pipeline-review decision LOGIC, extracted so exactly one implementation is
// reachable from both the break-glass `npx convex run pipelineReviews:decide`
// path (Decision 1 keeps that usable) and the admin panel's
// decidePipelineReviewFromPanel wrapper (spec criterion 3: do not duplicate or
// fork the rules). The caller supplies `reviewer` and `source`; the panel takes
// reviewer from the authenticated admin identity (closing the spoofing gap the
// current `npx convex run` fallback has), the break-glass path takes it from
// the argument.
export type PipelineDecideResult = {
  ok: boolean;
  error?: string;
  already?: true;
  state?: string;
};

export const applyPipelineDecision = async (
  ctx: MutationCtx,
  args: {
    reviewId: Id<"pipelineEligibilityReviews">;
    decision: "approved" | "rejected";
    reviewer: string;
    reason?: string;
    source: "admin_fallback" | "agent";
  },
): Promise<PipelineDecideResult> => {
  const review = await ctx.db.get(args.reviewId);
  if (review === null) {
    return { ok: false, error: "not_found" };
  }
  if (review.state !== "pending") {
    return { ok: true, already: true, state: review.state };
  }
  const member = await ctx.db.get(review.member_id);
  if (member === null) {
    return { ok: false, error: "not_found" };
  }
  // The pipeline INVARIANT, enforced in the SHARED path so BOTH the panel and
  // the break-glass `npx convex run` route are bound by it: an APPROVAL requires
  // the member to be standard-lane (women-only, Stage 0 §5), active, and to hold
  // a latest true pipeline consent written through an attested path (the consent
  // row IS the attestation proof). A rejection is always allowed (it withdraws,
  // never grants). This closes the gap where a review could be approved to `on`
  // with no consent on record.
  if (args.decision === "approved") {
    if (!canUsePipeline(member.member_lane)) {
      return { ok: false, error: "not_permitted" };
    }
    if (member.lifecycle_state !== "active") {
      return { ok: false, error: "not_permitted" };
    }
    const consent = await latestPipelineConsent(ctx, member._id);
    if (consent === null) {
      return { ok: false, error: "not_permitted" };
    }
  }
  // The detailed reason stays on the REVIEW row (not the immutable audit log).
  await ctx.db.patch(review._id, {
    state: args.decision,
    reviewer: args.reviewer,
    reason: args.reason,
  });
  await ctx.db.patch(member._id, {
    pipeline_state: pipelineStateOnDecision(args.decision),
  });
  // Audit summary is STRUCTURED and PII-free: no raw admin note is ever written
  // to the append-only log, only whether one was supplied (Stage 0 §8).
  await writeAudit(ctx, {
    actor: args.reviewer,
    role: args.source === "agent" ? "agent" : "admin_fallback",
    action: "decidePipelineReview",
    target_id: member._id,
    after_summary: `decision=${args.decision} reason_present=${args.reason !== undefined && args.reason.trim() !== ""}`,
    source: args.source,
  });
  return { ok: true, state: args.decision };
};
