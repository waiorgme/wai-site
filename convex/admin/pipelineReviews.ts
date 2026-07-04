import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireSuperAdmin } from "../lib/adminAuth";
import { applyPipelineDecision, type PipelineDecideResult } from "../lib/pipelineDecide";
import { latestPipelineConsent } from "../lib/pipeline";
import { maskName } from "../lib/adminMask";

// Admin pipeline-eligibility-reviews queue (spec criterion 3). Lists pending
// reviews for the two super admins and lets them decide one, wrapping the SAME
// decision logic the break-glass `npx convex run pipelineReviews:decide` uses
// (convex/lib/pipelineDecide.ts). This retires the standing ops obligation from
// specs/optin-toggles.spec.md ("Issam runs npx convex run pipelineReviews:decide
// twice a week... until the admin panel exists"); record the retirement in the
// merge handoff.

const DAY_MS = 24 * 60 * 60 * 1000;

export type PendingReviewRow = {
  reviewId: string;
  masked_name: string;
  lane: "standard" | "minor" | "ally" | "restricted_unknown";
  days_open: number;
  // The attested-consent evidence the admin must see before approving
  // (criterion 3): the date + source of the latest true pipeline consent, or
  // null if none is on record (in which case approval is refused server-side).
  consent_on_file: boolean;
  consent_date: number | null;
  consent_source: "join" | "claim" | "settings" | null;
};

export const listPendingReviews = query({
  args: {},
  handler: async (ctx): Promise<PendingReviewRow[]> => {
    await requireSuperAdmin(ctx);
    const now = Date.now();
    const reviews = await ctx.db
      .query("pipelineEligibilityReviews")
      .withIndex("by_state", (q) => q.eq("state", "pending"))
      .collect();
    const rows: PendingReviewRow[] = [];
    for (const review of reviews) {
      const member = await ctx.db.get(review.member_id);
      if (member === null) {
        continue;
      }
      const consent = await latestPipelineConsent(ctx, member._id);
      rows.push({
        reviewId: review._id,
        masked_name: maskName(member.name),
        lane: member.member_lane,
        days_open: Math.floor((now - review._creationTime) / DAY_MS),
        consent_on_file: consent !== null,
        consent_date: consent?.timestamp ?? null,
        consent_source: consent?.source ?? null,
      });
    }
    return rows;
  },
});

// decidePipelineReviewFromPanel: super-admin only, reviewer taken from the
// authenticated admin identity (never a free-text field, closing the spoofing
// gap the break-glass path has). It calls the shared logic, which itself calls
// nothing that could approve a non-`standard` lane or skip attestation: the
// review only ever exists for a member ensurePipelineReviewOnActivation opened,
// and that helper already gates on canUsePipeline (standard only) + a real
// attested consent row. The extra guard below is belt-and-braces (criterion 3:
// the panel can never approve a review for a non-`standard` lane) and is tested.
export const decidePipelineReviewFromPanel = mutation({
  args: {
    reviewId: v.id("pipelineEligibilityReviews"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PipelineDecideResult> => {
    // Mutations RETURN the neutral envelope for an unauthorized caller (never
    // throw); only queries throw (Stage 0 §7.1).
    let adminEmail: string;
    try {
      adminEmail = await requireSuperAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const review = await ctx.db.get(args.reviewId);
    if (review === null) {
      return { ok: false, error: "not_found" };
    }
    const member = await ctx.db.get(review.member_id);
    if (member === null) {
      return { ok: false, error: "not_found" };
    }
    // Hard guard: an approval can only ever land the women-only pipeline for a
    // standard-lane member. Unreachable in real data (the review is never opened
    // for another lane), but enforced anyway (Stage 0 §5).
    if (args.decision === "approved" && member.member_lane !== "standard") {
      return { ok: false, error: "not_permitted" };
    }
    return applyPipelineDecision(ctx, {
      reviewId: args.reviewId,
      decision: args.decision,
      reviewer: adminEmail,
      reason: args.reason,
      source: "admin_fallback",
    });
  },
});
