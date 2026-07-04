import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { pipelineStateOnDecision } from "./toggles";
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
    source: "admin_fallback";
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
  await ctx.db.patch(review._id, {
    state: args.decision,
    reviewer: args.reviewer,
    reason: args.reason,
  });
  await ctx.db.patch(member._id, {
    pipeline_state: pipelineStateOnDecision(args.decision),
  });
  await writeAudit(ctx, {
    actor: args.reviewer,
    role: "admin_fallback",
    action: "decidePipelineReview",
    target_id: member._id,
    after_summary: `review=${args.decision}${args.reason ? ` reason=${args.reason}` : ""}`,
    source: args.source,
  });
  return { ok: true, state: args.decision };
};
