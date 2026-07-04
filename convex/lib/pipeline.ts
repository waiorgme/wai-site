import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { writeAudit } from "./audit";
import { canUsePipeline } from "./toggles";

// The single source of truth for "does this member have a true, attested
// pipeline consent on record". Every attested path (join, claim, settings)
// writes the consent through insertConsent, so the LATEST pipeline
// consentRecord with value=true IS the attestation signal (there is no separate
// flag; the consent row IS the proof). Returns the row so callers can surface
// its date + source as evidence, or null when the latest is false/absent.
export const latestPipelineConsent = async (
  ctx: QueryCtx | MutationCtx,
  memberId: Id<"members">,
): Promise<Doc<"consentRecords"> | null> => {
  const latest = await ctx.db
    .query("consentRecords")
    .withIndex("by_member_type_time", (q) =>
      q.eq("member_id", memberId).eq("type", "pipeline"),
    )
    .order("desc")
    .first();
  return latest !== null && latest.value === true ? latest : null;
};

// The pipeline INVARIANT (optin-toggles spec): a true pipeline consent row is
// never actionable without the truthful-declaration attestation AND an
// eligibility review. Join and claim capture the ATTESTED consent (PRD §6.3
// requires the consent line on the join form); this opens the review the
// moment the member is real: at activation for a join, at claim for a
// migrated member. Idempotent; does nothing for ineligible lanes (the
// consent write paths already force those to false).
export const ensurePipelineReviewOnActivation = async (
  ctx: MutationCtx,
  member: Doc<"members">,
): Promise<void> => {
  if (!canUsePipeline(member.member_lane)) {
    return;
  }
  const current = member.pipeline_state ?? "off";
  if (current === "on" || current === "review_pending") {
    return;
  }
  const latest = await latestPipelineConsent(ctx, member._id);
  if (latest === null) {
    return;
  }
  await ctx.db.insert("pipelineEligibilityReviews", {
    member_id: member._id,
    state: "pending",
    timestamp: Date.now(),
  });
  await ctx.db.patch(member._id, { pipeline_state: "review_pending" });
  await writeAudit(ctx, {
    actor: member.email,
    role: "member",
    action: "setPipelineOptIn",
    target_id: member._id,
    after_summary:
      "attested pipeline consent from join/claim honoured; eligibility review opened",
    source: "system",
  });
};
