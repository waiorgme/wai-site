import { query } from "../_generated/server";
import { requireSuperAdmin } from "../lib/adminAuth";

// Console overview (panel-design spec criterion 9): PII-FREE COUNTS ONLY, for
// the admin console's Overview view. No names, no emails, no rows - just the
// numbers an operator needs to see what is waiting. Super-admin gated like
// every sibling admin query (requireSuperAdmin, deny-by-default: queries throw
// the neutral not_authorized so a non-admin caller learns nothing).
//
// The vault integrity rule (Migration & Claim-Wave Plan): the imported legacy
// list is "registered", NEVER implied active. legacy_registered and
// members_active are therefore separate numbers here and are never summed or
// conflated; the UI labels each in plain words.

export type AdminOverviewCounts = {
  // Members with lifecycle_state "active": signed up or claimed, email
  // confirmed. Distinct from legacy_registered by the integrity rule above.
  members_active: number;
  // Members in any non-active, non-archived lifecycle state: waiting on a
  // guardian, a review, or an email confirmation.
  members_waiting: number;
  // Every importedMembers row: the legacy list as imported ("registered").
  legacy_registered: number;
  // importedMembers rows a member has actually claimed.
  legacy_claimed: number;
  // Open counts matching EXACTLY what each queue lists (same definitions as
  // the four list queries, so the badges never disagree with the queues).
  queue_conflicts: number;
  queue_pipeline: number;
  queue_guardians: number;
  queue_data_requests: number;
};

export const getAdminOverview = query({
  args: {},
  handler: async (ctx): Promise<AdminOverviewCounts> => {
    await requireSuperAdmin(ctx);

    const members = await ctx.db.query("members").collect();
    const members_active = members.filter(
      (m) => m.lifecycle_state === "active",
    ).length;
    const members_waiting = members.filter(
      (m) => m.lifecycle_state !== "active" && m.lifecycle_state !== "archived",
    ).length;

    // Registered vs claimed: registered is the whole imported list, claimed is
    // the subset that moved across. Never conflated with members_active.
    const imported = await ctx.db.query("importedMembers").collect();
    const legacy_registered = imported.length;
    const legacy_claimed = imported.filter(
      (r) => r.claim_state === "claimed",
    ).length;

    // Same three states listConflicts returns (conflict + suppressed_minor +
    // the read-only archived_conflict trail).
    const queue_conflicts = imported.filter(
      (r) =>
        r.claim_state === "conflict" ||
        r.claim_state === "suppressed_minor" ||
        r.claim_state === "archived_conflict",
    ).length;

    // listPendingReviews skips a review whose member row is gone; match it.
    const pendingReviews = await ctx.db
      .query("pipelineEligibilityReviews")
      .withIndex("by_state", (q) => q.eq("state", "pending"))
      .collect();
    let queue_pipeline = 0;
    for (const review of pendingReviews) {
      const member = await ctx.db.get(review.member_id);
      if (member !== null) {
        queue_pipeline++;
      }
    }

    // listPendingGuardians lists pending + expired consents whose member row
    // still exists; match it.
    const consents = await ctx.db.query("guardianConsents").collect();
    let queue_guardians = 0;
    for (const consent of consents) {
      if (
        consent.confirmation_state !== "pending" &&
        consent.confirmation_state !== "expired"
      ) {
        continue;
      }
      const member = await ctx.db.get(consent.member_id);
      if (member !== null) {
        queue_guardians++;
      }
    }

    // listDataRequests lists submitted + identity_pending rows; match it.
    const submitted = await ctx.db
      .query("dataRequests")
      .withIndex("by_state", (q) => q.eq("state", "submitted"))
      .collect();
    const identityPending = await ctx.db
      .query("dataRequests")
      .withIndex("by_state", (q) => q.eq("state", "identity_pending"))
      .collect();
    const queue_data_requests = submitted.length + identityPending.length;

    return {
      members_active,
      members_waiting,
      legacy_registered,
      legacy_claimed,
      queue_conflicts,
      queue_pipeline,
      queue_guardians,
      queue_data_requests,
    };
  },
});
