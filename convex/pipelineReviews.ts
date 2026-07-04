import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { applyPipelineDecision } from "./lib/pipelineDecide";

// §7 decidePipelineReview, BREAK-GLASS PATH (Decision 1: even after the admin
// panel exists, Issam can still run this via `npx convex run`, e.g.
//   npx convex run pipelineReviews:decide '{"reviewId":"...","decision":"approved","reviewer":"Issam"}'
// The decision LOGIC lives once in convex/lib/pipelineDecide.ts; both this path
// and the panel's decidePipelineReviewFromPanel call it, so the rules are never
// forked. The panel takes `reviewer` from the authenticated admin; this
// break-glass path takes it from the argument.
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
  ): Promise<{ ok: boolean; error?: string; already?: true; state?: string }> =>
    applyPipelineDecision(ctx, { ...args, source: "admin_fallback" }),
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
