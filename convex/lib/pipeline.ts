import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { writeAudit } from "./audit";
import { canUsePipeline } from "./toggles";

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
  const latest = await ctx.db
    .query("consentRecords")
    .withIndex("by_member_type_time", (q) =>
      q.eq("member_id", member._id).eq("type", "pipeline"),
    )
    .order("desc")
    .first();
  if (latest === null || latest.value !== true) {
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
