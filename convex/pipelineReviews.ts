import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { pipelineStateOnDecision } from "./lib/toggles";
import { writeAudit } from "./lib/audit";

// §7 decidePipelineReview, ADMIN FALLBACK PATH (Stage 0: until the admin
// surface exists, Issam runs this via `npx convex run`, e.g.
//   npx convex run pipelineReviews:decide '{"reviewId":"...","decision":"approved","reviewer":"Issam"}'
// The light eligibility review is the high-consequence verification gate from
// the Age & Gender Verification stance.
export const decide = internalMutation({
  args: {
    reviewId: v.id("pipelineEligibilityReviews"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reviewer: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; error?: string; already?: true; state?: string }> => {
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
      source: "admin_fallback",
    });
    return { ok: true, state: args.decision };
  },
});

// Pending reviews for the recorded ops routine (see specs/optin-toggles.spec.md
// and the field spec vault note): Issam runs this twice a week and decides
// each within 3 working days.
//   npx convex run pipelineReviews:pendingCount
export const pendingCount = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ pending: number }> => {
    const rows = await ctx.db
      .query("pipelineEligibilityReviews")
      .withIndex("by_state", (q) => q.eq("state", "pending"))
      .collect();
    return { pending: rows.length };
  },
});
