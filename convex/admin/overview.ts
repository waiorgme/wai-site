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
  // Members in a PRE-ACTIVATION state only (email_unverified, consent_pending,
  // pending_guardian, claim_pending, pending_review) - exactly what the
  // Overview label says: waiting on a guardian, a review, or an email
  // confirmation. Dormant/suspended/erasure states are deliberately NOT in
  // this number; they are not "waiting on a step".
  members_waiting: number;
  // Every importedMembers row: the legacy list as imported ("registered").
  legacy_registered: number;
  // importedMembers rows a member has actually claimed.
  legacy_claimed: number;
  // OPEN work per queue, shown as "N waiting" badges. Open means a human may
  // act or attention is pending: for conflicts that is conflict +
  // suppressed_minor (the queue also lists the read-only archived_conflict
  // trail, which is deliberately NOT counted - archived rows would inflate
  // "waiting" forever). The other three match their list queries exactly.
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
    const waitingStates = new Set([
      "email_unverified",
      "consent_pending",
      "pending_guardian",
      "claim_pending",
      "pending_review",
    ]);
    const members_waiting = members.filter((m) =>
      waitingStates.has(m.lifecycle_state),
    ).length;

    // Registered vs claimed: registered is the whole imported list, claimed is
    // the subset that moved across. Never conflated with members_active.
    const imported = await ctx.db.query("importedMembers").collect();
    const legacy_registered = imported.length;
    const legacy_claimed = imported.filter(
      (r) => r.claim_state === "claimed",
    ).length;

    // Open conflicts only: conflict (needs a human decision) + suppressed_minor
    // (held under-18 rows the wave plan says to contact within 2 working days).
    // The queue view also lists archived_conflict as its read-only trail, but
    // trail rows are done work - counting them would keep the "waiting" badge
    // lit forever (verification finding, 2026-07-06).
    const queue_conflicts = imported.filter(
      (r) =>
        r.claim_state === "conflict" || r.claim_state === "suppressed_minor",
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

// Report aggregates (spec H18): sanctioned numbers only, computed over ACTIVE
// members, returned as counts with no individual rows. Minors are counted in
// operational totals elsewhere but partner-facing surfaces never include them;
// this internal ops view aggregates by profile facts only (country, career
// stage) and never returns names or contact data.
export type ReportAggregates = {
  pipeline_on: number;
  by_country: Array<{ label: string; count: number }>;
  by_career_stage: Array<{ label: string; count: number }>;
};

const topCounts = (
  values: Array<string | undefined>,
  cap: number,
): Array<{ label: string; count: number }> => {
  const tally = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    tally.set(value, (tally.get(value) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, cap);
};

export const getReportAggregates = query({
  args: {},
  handler: async (ctx): Promise<ReportAggregates> => {
    await requireSuperAdmin(ctx);
    const members = await ctx.db.query("members").collect();
    const active = members.filter((m) => m.lifecycle_state === "active");
    return {
      pipeline_on: active.filter((m) => m.pipeline_state === "on").length,
      by_country: topCounts(
        active.map((m) => m.country_of_residence),
        12,
      ),
      by_career_stage: topCounts(
        active.map((m) => m.career_stage_answer),
        8,
      ),
    };
  },
});
