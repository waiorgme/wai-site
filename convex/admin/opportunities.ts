import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internalMutation, mutation, query } from "../_generated/server";
import { requireAdmin } from "../lib/adminAuth";
import { writeAudit } from "../lib/audit";
import { notify } from "../lib/notify";
import { currentStanding } from "../lib/standing";
import { audienceMaySeeRow, laneMaySeeBoard } from "../opportunities";

// Admin opportunities console (panel-experience spec B7). Every function is
// admin gated (requireAdmin, deny-by-default): queries throw the
// neutral not_authorized, mutations return the §7.1 result envelope. Every
// write appends an immutable audit row. Lifecycle: draft -> open (publish) ->
// closed (admin close or the deadline cron) -> decided (results published);
// archive/close, never delete. Recording a result notifies the applicant, win
// or lose (the everyone-gets-an-answer rule).

const TITLE_MAX = 200;
const TEXT_MAX = 5000;
const NOTE_MAX = 500;
const REASON_MAX = 200;

type OpportunityType = "competitive" | "single_winner" | "evergreen";
type OpportunityState = "draft" | "open" | "closed" | "decided";
type ApplicationState =
  | "received"
  | "shortlisted"
  | "won"
  | "lost"
  | "withdrawn";

export type ApplicationCounts = {
  received: number;
  shortlisted: number;
  won: number;
  lost: number;
  withdrawn: number;
  // Everything except withdrawn: the "N applications" number the list shows.
  active: number;
};

export type AdminOpportunityRow = {
  opportunityId: Id<"opportunities">;
  title: string;
  partner_name: string | null;
  type: OpportunityType;
  audience: "women_only" | "open";
  state: OpportunityState;
  deadline: number | null;
  created_at: number;
  published_at: number | null;
  result_published_at: number | null;
  application_counts: ApplicationCounts;
};

export type AdminOpportunityDetail = AdminOpportunityRow & {
  description: string;
  what_to_submit: string | null;
  eligibility_note: string | null;
  how_to_claim: string | null;
  anchor_event_id: Id<"events"> | null;
};

export type AdminApplicationRow = {
  // The acting key for setShortlisted/recordResult.
  applicationId: Id<"opportunityApplications">;
  // The shortlisting view shows the applicant's name and standing, never her
  // email or any contact detail (no-bulk-PII rule; contact stays behind the
  // members-admin audited reveal).
  applicant_name: string;
  standing: "member" | "active_member" | "ambassador" | "leadership_circle";
  state: ApplicationState;
  statement: string | null;
  created_at: number;
};

const applicationCountsFor = async (
  ctx: QueryCtx,
  opportunityId: Id<"opportunities">,
): Promise<ApplicationCounts> => {
  const rows = await ctx.db
    .query("opportunityApplications")
    .withIndex("by_opportunity_state", (q) =>
      q.eq("opportunity_id", opportunityId),
    )
    .collect();
  const counts: ApplicationCounts = {
    received: 0,
    shortlisted: 0,
    won: 0,
    lost: 0,
    withdrawn: 0,
    active: 0,
  };
  for (const row of rows) {
    counts[row.state] += 1;
    if (row.state !== "withdrawn") {
      counts.active += 1;
    }
  }
  return counts;
};

const toAdminRow = (
  opportunity: Doc<"opportunities">,
  application_counts: ApplicationCounts,
): AdminOpportunityRow => ({
  opportunityId: opportunity._id,
  title: opportunity.title,
  partner_name: opportunity.partner_name ?? null,
  type: opportunity.type,
  audience: opportunity.audience,
  state: opportunity.state,
  deadline: opportunity.deadline ?? null,
  created_at: opportunity.created_at,
  published_at: opportunity.published_at ?? null,
  result_published_at: opportunity.result_published_at ?? null,
  application_counts,
});

// Every state, newest first, with application counts per row.
export const adminListOpportunities = query({
  args: {},
  handler: async (ctx): Promise<AdminOpportunityRow[]> => {
    await requireAdmin(ctx);
    const all = await ctx.db.query("opportunities").collect();
    all.sort((a, b) => b.created_at - a.created_at);
    const rows: AdminOpportunityRow[] = [];
    for (const opportunity of all) {
      rows.push(
        toAdminRow(
          opportunity,
          await applicationCountsFor(ctx, opportunity._id),
        ),
      );
    }
    return rows;
  },
});

// One listing with every field the edit form needs plus the applications
// summary.
export const getOpportunityAdmin = query({
  args: { id: v.id("opportunities") },
  handler: async (ctx, args): Promise<AdminOpportunityDetail | null> => {
    await requireAdmin(ctx);
    const opportunity = await ctx.db.get(args.id);
    if (opportunity === null) {
      return null;
    }
    return {
      ...toAdminRow(opportunity, await applicationCountsFor(ctx, args.id)),
      description: opportunity.description,
      what_to_submit: opportunity.what_to_submit ?? null,
      eligibility_note: opportunity.eligibility_note ?? null,
      how_to_claim: opportunity.how_to_claim ?? null,
      anchor_event_id: opportunity.anchor_event_id ?? null,
    };
  },
});

// The applications view per listing: name + standing + statement, NO emails
// (contact stays behind the members-admin audited reveal). Earliest first, so
// the shortlist reads in arrival order.
export const listApplications = query({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, args): Promise<AdminApplicationRow[]> => {
    await requireAdmin(ctx);
    const applications = await ctx.db
      .query("opportunityApplications")
      .withIndex("by_opportunity_state", (q) =>
        q.eq("opportunity_id", args.opportunityId),
      )
      .collect();
    applications.sort((a, b) => a.created_at - b.created_at);
    const rows: AdminApplicationRow[] = [];
    for (const application of applications) {
      const member = await ctx.db.get(application.member_id);
      if (member === null) {
        continue;
      }
      rows.push({
        applicationId: application._id,
        applicant_name: member.name,
        standing: currentStanding(member),
        state: application.state,
        statement: application.statement ?? null,
        created_at: application.created_at,
      });
    }
    return rows;
  },
});

type UpsertResult =
  | { ok: true; id: Id<"opportunities"> }
  | {
      ok: false;
      error:
        | "not_authorized"
        | "not_found"
        | "validation"
        | "closed"
        | "audience_locked";
    };

// Intake/edit form (spec B7). Type-specific validation: an evergreen listing
// needs how_to_claim and must not carry a deadline; competitive and
// single_winner need a deadline (the "11:59 PM GST" convention is a display
// label; the stored deadline is the epoch instant the cron compares).
export const upsertOpportunity = mutation({
  args: {
    id: v.optional(v.id("opportunities")),
    title: v.string(),
    partner_name: v.optional(v.string()),
    type: v.union(
      v.literal("competitive"),
      v.literal("single_winner"),
      v.literal("evergreen"),
    ),
    description: v.string(),
    what_to_submit: v.optional(v.string()),
    eligibility_note: v.optional(v.string()),
    how_to_claim: v.optional(v.string()),
    // Default women_only (spec B5): open must be chosen deliberately.
    audience: v.optional(v.union(v.literal("women_only"), v.literal("open"))),
    deadline: v.optional(v.number()),
    anchor_event_id: v.optional(v.id("events")),
  },
  handler: async (ctx, args): Promise<UpsertResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }

    const title = args.title.trim();
    const description = args.description.trim();
    const how_to_claim = args.how_to_claim?.trim() || undefined;
    const what_to_submit = args.what_to_submit?.trim() || undefined;
    const eligibility_note = args.eligibility_note?.trim() || undefined;
    const partner_name = args.partner_name?.trim() || undefined;
    if (
      title.length === 0 ||
      title.length > TITLE_MAX ||
      description.length === 0 ||
      description.length > TEXT_MAX ||
      (what_to_submit?.length ?? 0) > TEXT_MAX ||
      (eligibility_note?.length ?? 0) > TEXT_MAX ||
      (how_to_claim?.length ?? 0) > TEXT_MAX ||
      (partner_name?.length ?? 0) > TITLE_MAX
    ) {
      return { ok: false, error: "validation" };
    }
    // Type-specific shape (spec B5): evergreen = claim path, no deadline, no
    // applications; the other two = applications with a deadline.
    if (args.type === "evergreen") {
      if (how_to_claim === undefined || args.deadline !== undefined) {
        return { ok: false, error: "validation" };
      }
    } else if (args.deadline === undefined) {
      return { ok: false, error: "validation" };
    }

    const fields = {
      title,
      partner_name,
      type: args.type,
      description,
      what_to_submit,
      eligibility_note,
      how_to_claim,
      audience: args.audience ?? ("women_only" as const),
      deadline: args.deadline,
      anchor_event_id: args.anchor_event_id,
    };

    if (args.id !== undefined) {
      const existing = await ctx.db.get(args.id);
      if (existing === null) {
        return { ok: false, error: "not_found" };
      }
      // Closed/decided listings are settled records: never edited, never
      // deleted (archive/close rule). Corrections mean a new listing.
      if (existing.state === "closed" || existing.state === "decided") {
        return { ok: false, error: "closed" };
      }
      // Type sets the whole path (intake decision); once published it is
      // fixed so live applications can never be stranded under an evergreen
      // or re-shaped listing.
      if (existing.state === "open" && existing.type !== args.type) {
        return { ok: false, error: "validation" };
      }
      // The audience FREEZES once the listing is open (Gate 4 round 3):
      // members applied under an eligibility promise, and narrowing an open
      // pool to women_only (or widening one minors can then see in history)
      // would strand applications the rule now forbids. Draft edits stay
      // free - drafts cannot take applications.
      if (
        existing.state === "open" &&
        (args.audience ?? "women_only") !== existing.audience
      ) {
        return { ok: false, error: "audience_locked" };
      }
      await ctx.db.replace(args.id, {
        ...fields,
        state: existing.state,
        created_at: existing.created_at,
        published_at: existing.published_at,
        result_published_at: existing.result_published_at,
      });
      await writeAudit(ctx, {
        actor: adminEmail,
        role: "admin_fallback",
        action: "upsertOpportunity",
        target_id: args.id,
        before_summary: `state=${existing.state} type=${existing.type}`,
        after_summary: `edited type=${args.type} audience=${fields.audience} deadline_set=${args.deadline !== undefined}`,
        source: "admin_fallback",
      });
      return { ok: true, id: args.id };
    }

    const id = await ctx.db.insert("opportunities", {
      ...fields,
      state: "draft",
      created_at: Date.now(),
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "upsertOpportunity",
      target_id: id,
      after_summary: `created state=draft type=${args.type} audience=${fields.audience} deadline_set=${args.deadline !== undefined}`,
      source: "admin_fallback",
    });
    return { ok: true, id };
  },
});

type PublishResult =
  | { ok: true; already?: true }
  | { ok: false; error: "not_authorized" | "not_found" | "validation" };

// Publish (propose-then-confirm in the UI): draft -> open. Re-checks the
// type shape so a draft edited into an invalid state can never go live, and
// refuses a deadline already in the past (the cron would close it within the
// hour, which can only be a mistake).
export const publishOpportunity = mutation({
  args: { id: v.id("opportunities") },
  handler: async (ctx, args): Promise<PublishResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const opportunity = await ctx.db.get(args.id);
    if (opportunity === null) {
      return { ok: false, error: "not_found" };
    }
    if (opportunity.state === "open") {
      return { ok: true, already: true };
    }
    if (opportunity.state !== "draft") {
      return { ok: false, error: "not_found" };
    }
    const now = Date.now();
    if (opportunity.type === "evergreen") {
      if (
        opportunity.how_to_claim === undefined ||
        opportunity.deadline !== undefined
      ) {
        return { ok: false, error: "validation" };
      }
    } else if (
      opportunity.deadline === undefined ||
      opportunity.deadline <= now
    ) {
      return { ok: false, error: "validation" };
    }
    await ctx.db.patch(args.id, { state: "open", published_at: now });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "publishOpportunity",
      target_id: args.id,
      before_summary: "state=draft",
      after_summary: `state=open type=${opportunity.type}`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});

type CloseResult =
  | { ok: true; already?: true }
  | { ok: false; error: "not_authorized" | "not_found" };

// Close (propose-then-confirm in the UI): open -> closed. The optional reason
// is kept ON the opportunity record; the audit summary carries only
// reason_present (Gate 4 round 12).
export const closeOpportunity = mutation({
  args: { id: v.id("opportunities"), reason: v.optional(v.string()) },
  handler: async (ctx, args): Promise<CloseResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const opportunity = await ctx.db.get(args.id);
    if (opportunity === null) {
      return { ok: false, error: "not_found" };
    }
    if (opportunity.state === "closed") {
      return { ok: true, already: true };
    }
    if (opportunity.state !== "open") {
      return { ok: false, error: "not_found" };
    }
    const reason = (args.reason ?? "").trim().slice(0, REASON_MAX);
    await ctx.db.patch(args.id, {
      state: "closed",
      close_reason: reason.length > 0 ? reason : undefined,
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "closeOpportunity",
      target_id: args.id,
      before_summary: "state=open",
      after_summary: `state=closed reason_present=${reason.length > 0}`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});

type ShortlistResult =
  | { ok: true; already?: true }
  | { ok: false; error: "not_authorized" | "not_found" | "conflict" };

// The shortlist mark: received <-> shortlisted, both directions, audited.
// Decided or withdrawn applications never move.
export const setShortlisted = mutation({
  args: { applicationId: v.id("opportunityApplications"), on: v.boolean() },
  handler: async (ctx, args): Promise<ShortlistResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const application = await ctx.db.get(args.applicationId);
    if (application === null) {
      return { ok: false, error: "not_found" };
    }
    const target: ApplicationState = args.on ? "shortlisted" : "received";
    if (application.state === target) {
      return { ok: true, already: true };
    }
    const from: ApplicationState = args.on ? "received" : "shortlisted";
    if (application.state !== from) {
      return { ok: false, error: "conflict" };
    }
    await ctx.db.patch(args.applicationId, { state: target });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "setShortlisted",
      target_id: application.member_id,
      before_summary: `application ${args.applicationId} state=${from}`,
      after_summary: `application ${args.applicationId} state=${target}`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});

type ResultResult =
  | { ok: true; already?: true }
  | {
      ok: false;
      error:
        | "not_authorized"
        | "not_found"
        | "conflict"
        | "winner_exists"
        | "not_eligible";
    };

// Record a result (propose-then-confirm in the UI). Every applicant gets an
// answer, win or lose (the vault's everyone-gets-an-answer rule): the write
// notifies her in-app immediately. The optional note stays on the application
// row; the immutable audit summary carries only a note_present flag.
export const recordResult = mutation({
  args: {
    applicationId: v.id("opportunityApplications"),
    result: v.union(v.literal("won"), v.literal("lost")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ResultResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const application = await ctx.db.get(args.applicationId);
    if (application === null) {
      return { ok: false, error: "not_found" };
    }
    if (application.state === args.result) {
      return { ok: true, already: true };
    }
    // A different recorded result, or a withdrawn application, never flips.
    if (
      application.state !== "received" &&
      application.state !== "shortlisted"
    ) {
      return { ok: false, error: "conflict" };
    }
    const opportunity = await ctx.db.get(application.opportunity_id);
    if (opportunity === null) {
      return { ok: false, error: "not_found" };
    }
    // Belt to the audience freeze: a win is only recordable for a member who
    // STILL passes the listing's lane/audience rules (Gate 4 round 3 - e.g. a
    // member since corrected to minor or restricted). "Lost" always flows:
    // everyone gets an answer, whatever her lane became.
    if (args.result === "won") {
      const applicant = await ctx.db.get(application.member_id);
      if (
        applicant === null ||
        !laneMaySeeBoard(applicant) ||
        !audienceMaySeeRow(applicant, opportunity)
      ) {
        return { ok: false, error: "not_eligible" };
      }
    }
    // single_winner means ONE winner (Scholarship & Opportunity Workflow):
    // a second "won" on the same listing is refused, not silently stacked
    // (Gate 4 blocker, 2026-07-07).
    if (args.result === "won" && opportunity.type === "single_winner") {
      const siblings = await ctx.db
        .query("opportunityApplications")
        .withIndex("by_opportunity_state", (q) =>
          q.eq("opportunity_id", application.opportunity_id).eq("state", "won"),
        )
        .collect();
      if (siblings.length > 0) {
        return { ok: false, error: "winner_exists" };
      }
    }
    const note = (args.note ?? "").trim().slice(0, NOTE_MAX);
    await ctx.db.patch(args.applicationId, {
      state: args.result,
      result_note: note.length > 0 ? note : undefined,
      decided_at: Date.now(),
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "recordResult",
      target_id: application.member_id,
      before_summary: `application ${args.applicationId} state=${application.state}`,
      after_summary: `application ${args.applicationId} state=${args.result} note_present=${note.length > 0}`,
      source: "admin_fallback",
    });
    if (args.result === "won") {
      await notify(
        ctx,
        application.member_id,
        "application_result",
        "Congratulations, you were selected",
        `Congratulations! You have been selected for ${opportunity.title}. The note from the team is on your application, under My applications.`,
        "/portal#opportunities",
      );
    } else {
      await notify(
        ctx,
        application.member_id,
        "application_result",
        "About your application",
        `Thank you for applying to ${opportunity.title}. This one went to another member. Your profile stays in the running for what comes next - keep an eye on Opportunities.`,
        "/portal#opportunities",
      );
    }
    return { ok: true };
  },
});

type DecideResult =
  | { ok: true; already?: true }
  | {
      ok: false;
      error:
        | "not_authorized"
        | "not_found"
        | "evergreen"
        | "not_closed"
        | "unresolved_applications"
        | "multiple_winners";
    };

// Publish the results: closed -> decided, ONLY once every non-withdrawn
// application carries a result (won or lost). This is the server-side teeth
// of the everyone-gets-an-answer rule: a cycle cannot be declared finished
// while any applicant is still waiting.
export const decideOpportunity = mutation({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, args): Promise<DecideResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const opportunity = await ctx.db.get(args.opportunityId);
    if (opportunity === null) {
      return { ok: false, error: "not_found" };
    }
    if (opportunity.type === "evergreen") {
      return { ok: false, error: "evergreen" };
    }
    if (opportunity.state === "decided") {
      return { ok: true, already: true };
    }
    if (opportunity.state !== "closed") {
      return { ok: false, error: "not_closed" };
    }
    const applications = await ctx.db
      .query("opportunityApplications")
      .withIndex("by_opportunity_state", (q) =>
        q.eq("opportunity_id", args.opportunityId),
      )
      .collect();
    const unresolved = applications.some(
      (a) => a.state === "received" || a.state === "shortlisted",
    );
    if (unresolved) {
      return { ok: false, error: "unresolved_applications" };
    }
    // Belt to recordResult's braces: a single_winner cycle can never be
    // declared finished with two winners on record.
    if (
      opportunity.type === "single_winner" &&
      applications.filter((a) => a.state === "won").length > 1
    ) {
      return { ok: false, error: "multiple_winners" };
    }
    await ctx.db.patch(args.opportunityId, {
      state: "decided",
      result_published_at: Date.now(),
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "decideOpportunity",
      target_id: args.opportunityId,
      before_summary: "state=closed",
      after_summary: `state=decided applications=${applications.length}`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});

// The deadline cron's worker (spec B7 auto-close): flips every OPEN listing
// whose deadline has passed to closed, one audit row per close, actor/system
// attribution. Deadlines are stored as epoch instants (entered against the
// "11:59 PM GST" convention), so the comparison is timezone-safe by
// construction. Evergreen listings carry no deadline and are never touched.
export const closePastDeadlineOpportunities = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ closed: number }> => {
    const now = Date.now();
    const open = await ctx.db
      .query("opportunities")
      .withIndex("by_state_deadline", (q) => q.eq("state", "open"))
      .collect();
    let closed = 0;
    for (const opportunity of open) {
      if (opportunity.deadline === undefined || opportunity.deadline >= now) {
        continue;
      }
      await ctx.db.patch(opportunity._id, { state: "closed" });
      await writeAudit(ctx, {
        actor: "system",
        role: "system",
        action: "autoCloseOpportunity",
        target_id: opportunity._id,
        before_summary: "state=open",
        after_summary: "state=closed deadline_passed=true",
        source: "system",
      });
      closed += 1;
    }
    return { closed };
  },
});
