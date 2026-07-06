import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { notify } from "./lib/notify";
import { maybePromoteToActive } from "./lib/standing";
import { isProfileComplete } from "./lib/profile";

// Member-facing opportunities (panel-experience spec B6 + B8). The board and
// apply flow read the MEMBER LANE server-side; no UI is ever the only thing
// enforcing a restriction (Stage 0 §5). Minors and unknown-age members never
// see any opportunity (adult/contractual rule); women_only listings are hidden
// from the ally lane (dated ruling 2026-07-06); evergreen listings show a
// claim path and take no applications.
//
// Dated ruling (spec B8, 2026-07-06): APPLYING is gated on active lifecycle +
// profile complete + lane eligibility. Standing (Active Member+) gates
// priority RSVP and the directory only, so applying stays available as the
// qualifying action that PROMOTES standing (Recognition Thresholds Rung 2).

const STATEMENT_MAX = 5000;

type ApplicationState =
  | "received"
  | "shortlisted"
  | "won"
  | "lost"
  | "withdrawn";

type OpportunityType = "competitive" | "single_winner" | "evergreen";

export type OpportunityListRow = {
  opportunityId: Id<"opportunities">;
  title: string;
  partner_name: string | null;
  type: OpportunityType;
  description: string;
  eligibility_note: string | null;
  deadline: number | null;
  my_application_state: ApplicationState | null;
};

export type OpportunityDetail = {
  opportunityId: Id<"opportunities">;
  title: string;
  partner_name: string | null;
  type: OpportunityType;
  description: string;
  // Non-evergreen listings carry what to submit + the eligibility note;
  // evergreen listings carry how to claim instead (spec B5/B6).
  what_to_submit: string | null;
  eligibility_note: string | null;
  how_to_claim: string | null;
  deadline: number | null;
  my_application_state: ApplicationState | null;
  my_statement: string | null;
};

export type MyApplicationRow = {
  opportunityId: Id<"opportunities">;
  title: string;
  partner_name: string | null;
  type: OpportunityType;
  opportunity_state: "draft" | "open" | "closed" | "decided";
  state: ApplicationState;
  statement: string | null;
  result_note: string | null;
  created_at: number;
  decided_at: number | null;
};

const memberForAuthedUser = async (
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"members"> | null> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return ctx.db
    .query("members")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
};

// B6/B8 lane gate, applied before any opportunity row is read: only an ACTIVE
// member in the standard or ally lane may see the board at all. minor and
// restricted_unknown are switched off entirely (adult/contractual rule,
// Under-18 Safeguards Part 2).
const laneMaySeeBoard = (member: Doc<"members">): boolean =>
  member.lifecycle_state === "active" &&
  (member.member_lane === "standard" || member.member_lane === "ally");

// Per-row audience rule: women_only listings are hidden from the ally lane
// (dated ruling, spec B5). Evergreen rows follow the same audience rule, so
// they are visible to every lane that passes it.
const audienceMaySeeRow = (
  member: Doc<"members">,
  opportunity: Doc<"opportunities">,
): boolean =>
  opportunity.audience === "open" || member.member_lane === "standard";

const myApplicationFor = async (
  ctx: QueryCtx | MutationCtx,
  memberId: Id<"members">,
  opportunityId: Id<"opportunities">,
): Promise<Doc<"opportunityApplications"> | null> =>
  ctx.db
    .query("opportunityApplications")
    .withIndex("by_member_opportunity", (q) =>
      q.eq("member_id", memberId).eq("opportunity_id", opportunityId),
    )
    .unique();

// The board: OPEN rows the caller is eligible to see, each with her own
// application state. Ineligible callers (signed out, no member row, wrong
// lane, not active) get an empty board, never an error that reveals what
// exists.
export const listOpportunities = query({
  args: {},
  handler: async (ctx): Promise<OpportunityListRow[]> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null || !laneMaySeeBoard(member)) {
      return [];
    }
    const open = await ctx.db
      .query("opportunities")
      .withIndex("by_state_time", (q) => q.eq("state", "open"))
      .collect();
    const rows: OpportunityListRow[] = [];
    for (const opportunity of open) {
      if (!audienceMaySeeRow(member, opportunity)) {
        continue;
      }
      const application = await myApplicationFor(
        ctx,
        member._id,
        opportunity._id,
      );
      rows.push({
        opportunityId: opportunity._id,
        title: opportunity.title,
        partner_name: opportunity.partner_name ?? null,
        type: opportunity.type,
        description: opportunity.description,
        eligibility_note: opportunity.eligibility_note ?? null,
        deadline: opportunity.deadline ?? null,
        my_application_state: application?.state ?? null,
      });
    }
    // Nearest deadline first; evergreen (no deadline) listings at the end.
    rows.sort(
      (a, b) =>
        (a.deadline ?? Number.MAX_SAFE_INTEGER) -
        (b.deadline ?? Number.MAX_SAFE_INTEGER),
    );
    return rows;
  },
});

// One listing, same gating as the board. Evergreen carries how_to_claim;
// competitive/single_winner carry what_to_submit + eligibility_note.
export const getOpportunity = query({
  args: { id: v.id("opportunities") },
  handler: async (ctx, args): Promise<OpportunityDetail | null> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null || !laneMaySeeBoard(member)) {
      return null;
    }
    const opportunity = await ctx.db.get(args.id);
    if (
      opportunity === null ||
      opportunity.state !== "open" ||
      !audienceMaySeeRow(member, opportunity)
    ) {
      return null;
    }
    const application = await myApplicationFor(ctx, member._id, args.id);
    const evergreen = opportunity.type === "evergreen";
    return {
      opportunityId: opportunity._id,
      title: opportunity.title,
      partner_name: opportunity.partner_name ?? null,
      type: opportunity.type,
      description: opportunity.description,
      what_to_submit: evergreen ? null : (opportunity.what_to_submit ?? null),
      eligibility_note: evergreen
        ? null
        : (opportunity.eligibility_note ?? null),
      how_to_claim: evergreen ? (opportunity.how_to_claim ?? null) : null,
      deadline: opportunity.deadline ?? null,
      my_application_state: application?.state ?? null,
      my_statement: application?.statement ?? null,
    };
  },
});

type ApplyResult =
  | { ok: true; already?: true }
  | {
      ok: false;
      error:
        | "not_signed_in"
        | "not_eligible"
        | "validation"
        | "not_found"
        | "evergreen"
        | "closed"
        | "profile_incomplete";
    };

// Apply = confirm-what-we-have + statement (spec B6). Gated server-side on
// active lifecycle + lane eligibility + profile complete (dated ruling B8).
// One application per member per opportunity; late applications are refused
// politely; every application gets an automatic in-app acknowledgement.
export const apply = mutation({
  args: {
    opportunityId: v.id("opportunities"),
    statement: v.string(),
  },
  handler: async (ctx, args): Promise<ApplyResult> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return { ok: false, error: "not_signed_in" };
    }
    // Safeguarding lane gate, enforced whatever the UI showed. The refusal is
    // audited like the join/claim pipeline refusals (SEC-5 precedent).
    if (!laneMaySeeBoard(member)) {
      await writeAudit(ctx, {
        actor: member.email,
        role: "member",
        action: "applyToOpportunity.refused",
        target_id: member._id,
        after_summary: `apply refused lane=${member.member_lane} lifecycle=${member.lifecycle_state}`,
        source: "system",
      });
      return { ok: false, error: "not_eligible" };
    }
    const statement = args.statement.trim();
    if (statement.length === 0 || statement.length > STATEMENT_MAX) {
      return { ok: false, error: "validation" };
    }
    const opportunity = await ctx.db.get(args.opportunityId);
    // A draft row, a missing row, and a row her lane may not see all answer
    // the same way: nothing here.
    if (
      opportunity === null ||
      opportunity.state === "draft" ||
      !audienceMaySeeRow(member, opportunity)
    ) {
      return { ok: false, error: "not_found" };
    }
    // Evergreen listings take no applications: members claim directly from
    // the partner (the listing shows how).
    if (opportunity.type === "evergreen") {
      return { ok: false, error: "evergreen" };
    }
    // The polite late refusal: closed/decided rows, and open rows past their
    // deadline (the cron may simply not have run yet), both refuse the same
    // way. The UI words it kindly; the server just tells the truth.
    const now = Date.now();
    if (
      opportunity.state !== "open" ||
      (opportunity.deadline !== undefined && opportunity.deadline < now)
    ) {
      return { ok: false, error: "closed" };
    }
    // Dated ruling (B8): profile complete is required to apply. The UI routes
    // this error to the profile editor.
    if (!isProfileComplete(member)) {
      return { ok: false, error: "profile_incomplete" };
    }
    // One application per member per opportunity (by_member_opportunity).
    const existing = await myApplicationFor(ctx, member._id, args.opportunityId);
    if (existing !== null && existing.state !== "withdrawn") {
      return { ok: true, already: true };
    }
    if (existing !== null) {
      // She withdrew earlier and the listing is still open: the unique pair
      // row re-opens as a fresh application (never a second row).
      await ctx.db.patch(existing._id, {
        state: "received",
        statement,
        result_note: undefined,
        created_at: now,
        decided_at: undefined,
      });
    } else {
      await ctx.db.insert("opportunityApplications", {
        opportunity_id: args.opportunityId,
        member_id: member._id,
        statement,
        state: "received",
        created_at: now,
      });
    }
    await writeAudit(ctx, {
      actor: member.email,
      role: "member",
      action: "applyToOpportunity",
      target_id: member._id,
      after_summary: `application received opportunity=${args.opportunityId}${existing !== null ? " reopened_after_withdrawal=true" : ""}`,
      source: "member",
    });
    // The automatic acknowledgement (everyone-gets-an-answer rule, half one).
    await notify(
      ctx,
      member._id,
      "application_received",
      "Application received",
      `We've got your application for ${opportunity.title}. Every applicant hears back, win or lose.`,
      "/portal/opportunities",
    );
    // Applying is a qualifying action for the automatic Rung-2 standing gate.
    await maybePromoteToActive(ctx, member._id, "applied to an opportunity");
    return { ok: true };
  },
});

type WithdrawResult =
  | { ok: true; already?: true }
  | { ok: false; error: "not_signed_in" | "not_found" | "decided" };

// A member may withdraw her own application while it is still in play
// (received or shortlisted). A decided application (won/lost) is a recorded
// result and stays.
export const withdrawMyApplication = mutation({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, args): Promise<WithdrawResult> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return { ok: false, error: "not_signed_in" };
    }
    const application = await myApplicationFor(
      ctx,
      member._id,
      args.opportunityId,
    );
    if (application === null) {
      return { ok: false, error: "not_found" };
    }
    if (application.state === "withdrawn") {
      return { ok: true, already: true };
    }
    if (application.state !== "received" && application.state !== "shortlisted") {
      return { ok: false, error: "decided" };
    }
    await ctx.db.patch(application._id, { state: "withdrawn" });
    await writeAudit(ctx, {
      actor: member.email,
      role: "member",
      action: "withdrawMyApplication",
      target_id: member._id,
      before_summary: `application state=${application.state}`,
      after_summary: `application state=withdrawn opportunity=${args.opportunityId}`,
      source: "member",
    });
    return { ok: true };
  },
});

// Her applications with honest states, joined with the listing's title and
// state so "my applications" can tell the whole truth (including results on
// closed/decided listings that no longer appear on the board).
export const myApplications = query({
  args: {},
  handler: async (ctx): Promise<MyApplicationRow[]> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return [];
    }
    const applications = await ctx.db
      .query("opportunityApplications")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .order("desc")
      .collect();
    const rows: MyApplicationRow[] = [];
    for (const application of applications) {
      const opportunity = await ctx.db.get(application.opportunity_id);
      if (opportunity === null) {
        continue;
      }
      rows.push({
        opportunityId: application.opportunity_id,
        title: opportunity.title,
        partner_name: opportunity.partner_name ?? null,
        type: opportunity.type,
        opportunity_state: opportunity.state,
        state: application.state,
        statement: application.statement ?? null,
        result_note: application.result_note ?? null,
        created_at: application.created_at,
        decided_at: application.decided_at ?? null,
      });
    }
    return rows;
  },
});
