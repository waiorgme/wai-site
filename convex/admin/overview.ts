import { query } from "../_generated/server";
import { requireAdmin } from "../lib/adminAuth";

// Console overview (panel-design spec criterion 9): PII-FREE COUNTS ONLY, for
// the admin console's Overview view. No names, no emails, no rows - just the
// numbers an operator needs to see what is waiting. Super-admin gated like
// every sibling admin query (requireAdmin, deny-by-default: queries throw
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
    await requireAdmin(ctx);

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
    await requireAdmin(ctx);
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

// Platform health (activity-log spec §C.10): the join funnel + the four
// kill-criteria counters from PRD §13. Aggregate counts only, like every
// sibling. Thresholds are the PRD's "figures tunable" defaults; the settled
// rule is "pause heavy build and rethink if 2 or more are missed" at the
// fixed 6-month review. `missed` is null wherever the measure is not
// meaningful yet (no imported list, no claims) - the UI words that honestly.
const CLAIM_RATE_THRESHOLD_PCT = 25;
const MONTHLY_ACTIVE_THRESHOLD_PCT = 15;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export type PlatformHealth = {
  funnel: {
    join_submitted: number;
    email_confirmed: number;
    onboarding_started: number;
  };
  kill_criteria: {
    claim_rate: {
      claimed: number;
      registered: number;
      pct: number | null;
      threshold_pct: number;
      missed: boolean | null;
    };
    event_floor: {
      months_checked: number;
      months_missed: number;
      missed: boolean;
    };
    corporate_partners: { active_count: number; missed: boolean };
    monthly_active: {
      active_30d: number;
      claimed: number;
      pct: number | null;
      threshold_pct: number;
      missed: boolean | null;
    };
  };
  review_at: number | null;
};

export const getPlatformHealth = query({
  args: {},
  handler: async (ctx): Promise<PlatformHealth> => {
    await requireAdmin(ctx);
    const now = Date.now();

    const activity = await ctx.db.query("activityLog").collect();
    const countType = (type: string) =>
      activity.filter((a) => a.type === type).length;

    // Distinct members with any first-party activity in the trailing 30 days.
    const activeMembers30d = new Set(
      activity
        .filter((a) => a.at >= now - THIRTY_DAYS && a.member_id !== undefined)
        .map((a) => a.member_id as string),
    ).size;

    // Claim rate: the same registered/claimed definitions as the Overview
    // (integrity rule: registered is the list as imported, never "active").
    const imported = await ctx.db.query("importedMembers").collect();
    const registered = imported.length;
    const claimed = imported.filter((r) => r.claim_state === "claimed").length;
    const claimPct =
      registered === 0 ? null : Math.round((claimed / registered) * 1000) / 10;

    // Event floor: one held event per calendar month (the guaranteed 12/12
    // floor). Checked over the six most recent COMPLETED months - the
    // running month can't have "missed" anything yet. An event counts as
    // held for the month it started in once it actually took place.
    const events = await ctx.db.query("events").collect();
    const held = events.filter(
      (e) =>
        e.state === "attendance_finalized" ||
        ((e.state === "published" || e.state === "postponed") &&
          e.ends_at <= now),
    );
    const monthKey = (ts: number) => {
      const d = new Date(ts);
      return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    };
    const heldMonths = new Set(held.map((e) => monthKey(e.starts_at)));
    const current = new Date(now);
    let monthsMissed = 0;
    for (let back = 1; back <= 6; back++) {
      const m = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - back, 1),
      );
      if (!heldMonths.has(monthKey(m.getTime()))) {
        monthsMissed++;
      }
    }

    const partners = await ctx.db.query("partners").collect();
    const activePartners = partners.filter((p) => p.status === "active").length;

    const monthlyActivePct =
      claimed === 0
        ? null
        : Math.round((activeMembers30d / claimed) * 1000) / 10;

    const reviewRow = await ctx.db
      .query("counters")
      .withIndex("by_name", (q) => q.eq("name", "platform_review_at"))
      .unique();

    return {
      funnel: {
        join_submitted: countType("join_submitted"),
        email_confirmed: countType("email_confirmed"),
        onboarding_started: countType("onboarding_started"),
      },
      kill_criteria: {
        claim_rate: {
          claimed,
          registered,
          pct: claimPct,
          threshold_pct: CLAIM_RATE_THRESHOLD_PCT,
          missed: claimPct === null ? null : claimPct < CLAIM_RATE_THRESHOLD_PCT,
        },
        event_floor: {
          months_checked: 6,
          months_missed: monthsMissed,
          missed: monthsMissed >= 2,
        },
        corporate_partners: {
          active_count: activePartners,
          missed: activePartners === 0,
        },
        monthly_active: {
          active_30d: activeMembers30d,
          claimed,
          pct: monthlyActivePct,
          threshold_pct: MONTHLY_ACTIVE_THRESHOLD_PCT,
          missed:
            monthlyActivePct === null
              ? null
              : monthlyActivePct < MONTHLY_ACTIVE_THRESHOLD_PCT,
        },
      },
      review_at: reviewRow?.value ?? null,
    };
  },
});
