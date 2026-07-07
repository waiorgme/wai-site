import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requireAdmin } from "../lib/adminAuth";
import { isValidJoinEmail } from "../lib/joinValidation";
import { writeAudit } from "../lib/audit";
import { logActivityOnce } from "../lib/activity";
import { notify } from "../lib/notify";
import { maybePromoteToActive } from "../lib/standing";
import { eventDateLabel } from "../events";

// Admin events console (panel-experience spec §A.3). Every function here is
// requireAdmin, deny-by-default: queries throw the neutral not_authorized,
// mutations return the §7.1 envelope. Every write appends a PII-free audit row.
// Events are never deleted: cancel and finalize are the closing moves, and a
// cancelled/finalized event is read-only history.

const eventCategory = v.union(
  v.literal("workshop"),
  v.literal("story_session"),
  v.literal("briefing"),
  v.literal("skills_clinic"),
  v.literal("meetup"),
  v.literal("conference"),
);

type StateCounts = {
  registered: number;
  waitlisted: number;
  cancelled: number;
  attended: number;
  no_show: number;
};

const REGISTRATION_STATES = [
  "registered",
  "waitlisted",
  "cancelled",
  "attended",
  "no_show",
] as const;

const countsForEvent = async (
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
): Promise<StateCounts> => {
  const counts: StateCounts = {
    registered: 0,
    waitlisted: 0,
    cancelled: 0,
    attended: 0,
    no_show: 0,
  };
  for (const state of REGISTRATION_STATES) {
    const rows = await ctx.db
      .query("eventRegistrations")
      .withIndex("by_event_state", (q) =>
        q.eq("event_id", eventId).eq("state", state),
      )
      .collect();
    counts[state] = rows.length;
  }
  return counts;
};

export type AdminEventRow = {
  eventId: Id<"events">;
  title: string;
  category: Doc<"events">["category"];
  starts_at: number;
  ends_at: number;
  timezone: string;
  format: "online" | "in_person";
  audience_lane: "adult" | "youth";
  state: Doc<"events">["state"];
  capacity: number | null;
  published_at: number | null;
  counts: StateCounts;
};

// Every event in every state, newest start first, with per-event counts.
export const adminListEvents = query({
  args: {},
  handler: async (ctx): Promise<AdminEventRow[]> => {
    await requireAdmin(ctx);
    const events = await ctx.db.query("events").collect();
    events.sort((a, b) => b.starts_at - a.starts_at);
    const rows: AdminEventRow[] = [];
    for (const event of events) {
      rows.push({
        eventId: event._id,
        title: event.title,
        category: event.category,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        timezone: event.timezone,
        format: event.format,
        audience_lane: event.audience_lane,
        state: event.state,
        capacity: event.capacity ?? null,
        published_at: event.published_at ?? null,
        counts: await countsForEvent(ctx, event._id),
      });
    }
    return rows;
  },
});

export type AdminEventDetail = {
  eventId: Id<"events">;
  title: string;
  category: Doc<"events">["category"];
  short_description: string;
  description: string | null;
  starts_at: number;
  ends_at: number;
  timezone: string;
  format: "online" | "in_person";
  meeting_link: string | null;
  venue: string | null;
  city: string | null;
  host_name: string | null;
  host_email: string | null;
  audience_lane: "adult" | "youth";
  capacity: number | null;
  registration_closes_at: number | null;
  priority_window_start: number | null;
  priority_window_end: number | null;
  state: Doc<"events">["state"];
  cancelled_reason: string | null;
  recording_url: string | null;
  materials_url: string | null;
  created_at: number;
  published_at: number | null;
  counts: StateCounts;
};

export const getEventAdmin = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args): Promise<AdminEventDetail | null> => {
    await requireAdmin(ctx);
    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      return null;
    }
    return {
      eventId: event._id,
      title: event.title,
      category: event.category,
      short_description: event.short_description,
      description: event.description ?? null,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      timezone: event.timezone,
      format: event.format,
      meeting_link: event.meeting_link ?? null,
      venue: event.venue ?? null,
      city: event.city ?? null,
      host_name: event.host_name ?? null,
      host_email: event.host_email ?? null,
      audience_lane: event.audience_lane,
      capacity: event.capacity ?? null,
      registration_closes_at: event.registration_closes_at ?? null,
      priority_window_start: event.priority_window_start ?? null,
      priority_window_end: event.priority_window_end ?? null,
      state: event.state,
      cancelled_reason: event.cancelled_reason ?? null,
      recording_url: event.recording_url ?? null,
      materials_url: event.materials_url ?? null,
      created_at: event.created_at,
      published_at: event.published_at ?? null,
      counts: await countsForEvent(ctx, event._id),
    };
  },
});

type UpsertResult =
  | { ok: true; eventId: Id<"events"> }
  | {
      ok: false;
      error:
        | "not_authorized"
        | "not_found"
        | "validation"
        | "invalid_state"
        | "lane_locked"
        | "capacity_below_registered"
        | "times_locked";
    };

// Create (draft) or edit an event. Edits to published/postponed events are
// allowed and audited (fixing a typo or venue on a live listing is normal
// operator work); cancelled and finalized events are closed history. The form
// submits the full field set, so an omitted optional field clears.
export const upsertEvent = mutation({
  args: {
    eventId: v.optional(v.id("events")),
    title: v.string(),
    category: eventCategory,
    short_description: v.string(),
    description: v.optional(v.string()),
    starts_at: v.number(),
    ends_at: v.number(),
    timezone: v.optional(v.string()),
    format: v.union(v.literal("online"), v.literal("in_person")),
    meeting_link: v.optional(v.string()),
    venue: v.optional(v.string()),
    city: v.optional(v.string()),
    host_name: v.optional(v.string()),
    host_email: v.optional(v.string()),
    audience_lane: v.union(v.literal("adult"), v.literal("youth")),
    capacity: v.optional(v.number()),
    registration_closes_at: v.optional(v.number()),
    priority_window_start: v.optional(v.number()),
    priority_window_end: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<UpsertResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }

    const title = args.title.trim();
    const short = args.short_description.trim();
    if (title.length < 1 || title.length > 200) {
      return { ok: false, error: "validation" };
    }
    if (short.length < 1 || short.length > 500) {
      return { ok: false, error: "validation" };
    }
    if (args.ends_at <= args.starts_at) {
      return { ok: false, error: "validation" };
    }
    if (
      args.capacity !== undefined &&
      (!Number.isInteger(args.capacity) || args.capacity < 1)
    ) {
      return { ok: false, error: "validation" };
    }
    // Priority window: both ends or neither, and it must end after it starts.
    const hasWindowStart = args.priority_window_start !== undefined;
    const hasWindowEnd = args.priority_window_end !== undefined;
    if (hasWindowStart !== hasWindowEnd) {
      return { ok: false, error: "validation" };
    }
    if (
      hasWindowStart &&
      hasWindowEnd &&
      (args.priority_window_end as number) <=
        (args.priority_window_start as number)
    ) {
      return { ok: false, error: "validation" };
    }

    // The meeting link becomes a member-facing href once she registers:
    // https only, bounded length, same rule as recording/materials
    // (Gate 4 blocker, 2026-07-07).
    if (
      args.meeting_link !== undefined &&
      !(args.meeting_link.startsWith("https://") && args.meeting_link.length <= 500)
    ) {
      return { ok: false, error: "validation" };
    }

    // Host contact and the remaining free text are admin-entered but stored,
    // and description/venue/city/host_name are member-visible: same boundary
    // discipline as everything else (audit sweep, 2026-07-07).
    const hostEmail = args.host_email?.trim() || undefined;
    if (hostEmail !== undefined && !isValidJoinEmail(hostEmail)) {
      return { ok: false, error: "validation" };
    }
    if (
      (args.description ?? "").length > 5000 ||
      (args.venue ?? "").length > 200 ||
      (args.city ?? "").length > 100 ||
      (args.host_name ?? "").length > 120 ||
      (args.timezone ?? "").length > 64
    ) {
      return { ok: false, error: "validation" };
    }

    const timezone =
      args.timezone === undefined || args.timezone.trim() === ""
        ? "GST"
        : args.timezone.trim();

    const fields = {
      title,
      category: args.category,
      short_description: short,
      description: args.description,
      starts_at: args.starts_at,
      ends_at: args.ends_at,
      timezone,
      format: args.format,
      meeting_link: args.meeting_link,
      venue: args.venue,
      city: args.city,
      host_name: args.host_name,
      host_email: hostEmail,
      audience_lane: args.audience_lane,
      capacity: args.capacity,
      registration_closes_at: args.registration_closes_at,
      priority_window_start: args.priority_window_start,
      priority_window_end: args.priority_window_end,
    };

    if (args.eventId === undefined) {
      const eventId = await ctx.db.insert("events", {
        ...fields,
        state: "draft",
        created_at: Date.now(),
      });
      await writeAudit(ctx, {
        actor: adminEmail,
        role: "admin_fallback",
        action: "upsertEvent",
        target_id: eventId,
        after_summary: `created state=draft lane=${args.audience_lane}`,
        source: "admin_fallback",
      });
      return { ok: true, eventId };
    }

    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      return { ok: false, error: "not_found" };
    }
    if (event.state === "cancelled" || event.state === "attendance_finalized") {
      return { ok: false, error: "invalid_state" };
    }
    // The audience lane FREEZES once the event leaves draft (Gate 4 round 3):
    // members RSVP under a lane promise, and flipping a youth session to
    // adult (or back) would leave bookings the lane rule now forbids. Drafts
    // cannot carry registrations (RSVP requires published), so draft edits
    // stay free.
    if (event.state !== "draft" && args.audience_lane !== event.audience_lane) {
      return { ok: false, error: "lane_locked" };
    }
    // Live events cannot MOVE through a plain save (Gate 4 round 6): time
    // changes must ride postponeEvent, which notifies every booking holder.
    // The UI already locks the fields; this is the server-side teeth, so a
    // direct Convex call cannot move an event silently either. Compared at
    // minute precision (the editor's datetime inputs round-trip at minutes),
    // and the stored values are kept verbatim so precision never drifts.
    if (event.state !== "draft") {
      const minute = (ms: number) => Math.floor(ms / 60000);
      if (
        minute(args.starts_at) !== minute(event.starts_at) ||
        minute(args.ends_at) !== minute(event.ends_at)
      ) {
        return { ok: false, error: "times_locked" };
      }
      fields.starts_at = event.starts_at;
      fields.ends_at = event.ends_at;
    }
    // A live room cannot shrink below the seats already confirmed (Gate 4
    // round 5): registered members hold real seats, and the waitlist
    // promoter must never be handed an overbooked event.
    if (event.state !== "draft" && args.capacity !== undefined) {
      const registered = await ctx.db
        .query("eventRegistrations")
        .withIndex("by_event_state", (q) =>
          q.eq("event_id", event._id).eq("state", "registered"),
        )
        .collect();
      if (args.capacity < registered.length) {
        return { ok: false, error: "capacity_below_registered" };
      }
    }
    await ctx.db.patch(event._id, fields);
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "upsertEvent",
      target_id: event._id,
      before_summary: `state=${event.state}`,
      after_summary: `edited state=${event.state} lane=${args.audience_lane}`,
      source: "admin_fallback",
    });
    return { ok: true, eventId: event._id };
  },
});

type StateChangeResult =
  | { ok: true; already?: true }
  | {
      ok: false;
      error: "not_authorized" | "not_found" | "validation" | "invalid_state";
    };

// Draft to published: the one move that puts an event on the member board.
export const publishEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args): Promise<StateChangeResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      return { ok: false, error: "not_found" };
    }
    if (event.state === "published") {
      return { ok: true, already: true };
    }
    if (event.state !== "draft") {
      return { ok: false, error: "invalid_state" };
    }
    await ctx.db.patch(event._id, {
      state: "published",
      published_at: Date.now(),
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "publishEvent",
      target_id: event._id,
      before_summary: "state=draft",
      after_summary: `state=published lane=${event.audience_lane}`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});

// Every member currently holding a live booking on this event: registered and
// waitlisted rows both get told about cancellations and postponements.
const liveRegistrations = async (
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<Doc<"eventRegistrations">[]> => {
  const rows: Doc<"eventRegistrations">[] = [];
  for (const state of ["registered", "waitlisted"] as const) {
    const batch = await ctx.db
      .query("eventRegistrations")
      .withIndex("by_event_state", (q) =>
        q.eq("event_id", eventId).eq("state", state),
      )
      .collect();
    rows.push(...batch);
  }
  return rows;
};

type NotifyingChangeResult =
  | { ok: true; notified: number }
  | {
      ok: false;
      error: "not_authorized" | "not_found" | "validation" | "invalid_state";
    };

// Cancel a published or postponed event. Every registered and waitlisted
// member is told in plain words, including the reason; the audit row carries
// the notified count (PII-free, the reason text stays on the event row).
export const cancelEvent = mutation({
  args: { eventId: v.id("events"), reason: v.string() },
  handler: async (ctx, args): Promise<NotifyingChangeResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const reason = args.reason.trim();
    if (reason.length < 1 || reason.length > 300) {
      return { ok: false, error: "validation" };
    }
    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      return { ok: false, error: "not_found" };
    }
    if (event.state !== "published" && event.state !== "postponed") {
      return { ok: false, error: "invalid_state" };
    }
    const before = event.state;
    await ctx.db.patch(event._id, {
      state: "cancelled",
      cancelled_reason: reason,
    });
    const holders = await liveRegistrations(ctx, event._id);
    for (const reg of holders) {
      await notify(
        ctx,
        reg.member_id,
        "event_update",
        `Cancelled: ${event.title}`,
        `We're sorry, ${event.title} on ${eventDateLabel(event.starts_at)} is cancelled. ${reason.replace(/\.\s*$/, "")}. We hope to see you at the next one.`,
        "/portal#events",
      );
    }
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "cancelEvent",
      target_id: event._id,
      before_summary: `state=${before}`,
      after_summary: `state=cancelled notified=${holders.length} reason_present=true`,
      source: "admin_fallback",
    });
    return { ok: true, notified: holders.length };
  },
});

// Postpone a published (or already postponed) event to new times. Bookings
// stand; everyone holding one is told the new date.
export const postponeEvent = mutation({
  args: {
    eventId: v.id("events"),
    newStartsAt: v.number(),
    newEndsAt: v.number(),
  },
  handler: async (ctx, args): Promise<NotifyingChangeResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    if (args.newEndsAt <= args.newStartsAt) {
      return { ok: false, error: "validation" };
    }
    // A postpone moves the event FORWARD; a past-dated new start would land
    // it already-over (hunt, 2026-07-07).
    if (args.newStartsAt <= Date.now()) {
      return { ok: false, error: "validation" };
    }
    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      return { ok: false, error: "not_found" };
    }
    if (event.state !== "published" && event.state !== "postponed") {
      return { ok: false, error: "invalid_state" };
    }
    const before = event.state;
    // The registration cutoff and priority window were set on the OLD
    // timeline. A cutoff normally sits just before the event start, so the
    // test is not "before the new start" but "already ELAPSED": one now in
    // the past would silently block RSVPs on a future event (the postpone
    // promise is "keeps taking RSVPs on the new date"). Clear an elapsed
    // cutoff; keep a still-future one (the admin's intent). The priority
    // window is a PAIR - cleared as a whole once its end has passed.
    const now = Date.now();
    const staleCutoff =
      event.registration_closes_at !== undefined &&
      event.registration_closes_at < now;
    const staleWindow =
      event.priority_window_end !== undefined &&
      event.priority_window_end <= now;
    await ctx.db.patch(event._id, {
      state: "postponed",
      starts_at: args.newStartsAt,
      ends_at: args.newEndsAt,
      registration_closes_at: staleCutoff
        ? undefined
        : event.registration_closes_at,
      priority_window_start: staleWindow
        ? undefined
        : event.priority_window_start,
      priority_window_end: staleWindow ? undefined : event.priority_window_end,
    });
    const holders = await liveRegistrations(ctx, event._id);
    for (const reg of holders) {
      await notify(
        ctx,
        reg.member_id,
        "event_update",
        `New date: ${event.title}`,
        `${event.title} has moved to ${eventDateLabel(args.newStartsAt)}. Your booking still stands, there is nothing you need to do.`,
        "/portal#events",
      );
    }
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "postponeEvent",
      target_id: event._id,
      before_summary: `state=${before}`,
      after_summary: `state=postponed notified=${holders.length}`,
      source: "admin_fallback",
    });
    return { ok: true, notified: holders.length };
  },
});

// Post-event recording/materials links (best-effort recording is the MVP rule;
// the links are members-only, gated on the member side to registered/attended).
export const setEventLinks = mutation({
  args: {
    eventId: v.id("events"),
    recording_url: v.optional(v.string()),
    materials_url: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<StateChangeResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    if (args.recording_url === undefined && args.materials_url === undefined) {
      return { ok: false, error: "validation" };
    }
    const isHttps = (url: string): boolean =>
      url.startsWith("https://") && url.length <= 500;
    if (args.recording_url !== undefined && !isHttps(args.recording_url)) {
      return { ok: false, error: "validation" };
    }
    if (args.materials_url !== undefined && !isHttps(args.materials_url)) {
      return { ok: false, error: "validation" };
    }
    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      return { ok: false, error: "not_found" };
    }
    if (event.state === "draft" || event.state === "cancelled") {
      return { ok: false, error: "invalid_state" };
    }
    const patch: { recording_url?: string; materials_url?: string } = {};
    if (args.recording_url !== undefined) {
      patch.recording_url = args.recording_url;
    }
    if (args.materials_url !== undefined) {
      patch.materials_url = args.materials_url;
    }
    await ctx.db.patch(event._id, patch);
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "setEventLinks",
      target_id: event._id,
      after_summary: `recording=${args.recording_url !== undefined} materials=${args.materials_url !== undefined}`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});

export type AdminRegistrationRow = {
  registrationId: Id<"eventRegistrations">;
  name: string;
  state: Doc<"eventRegistrations">["state"];
  promoted_from_waitlist_at: number | null;
  created_at: number;
};

// The operator's check-in view: names are sanctioned for the desk (the
// producer marks who showed), emails are NOT (hosts and desks never see
// attendee contact details, Workshop System safeguarding rule).
export const listRegistrations = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args): Promise<AdminRegistrationRow[]> => {
    await requireAdmin(ctx);
    const regs = await ctx.db
      .query("eventRegistrations")
      .withIndex("by_event_state", (q) => q.eq("event_id", args.eventId))
      .collect();
    regs.sort((a, b) => a.created_at - b.created_at);
    const rows: AdminRegistrationRow[] = [];
    for (const reg of regs) {
      const member = await ctx.db.get(reg.member_id);
      rows.push({
        registrationId: reg._id,
        name: member?.name ?? "Unknown member",
        state: reg.state,
        promoted_from_waitlist_at: reg.promoted_from_waitlist_at ?? null,
        created_at: reg.created_at,
      });
    }
    return rows;
  },
});

type CheckInResult =
  | { ok: true; state: "attended" | "no_show"; already?: true }
  | {
      ok: false;
      error:
        | "not_authorized"
        | "not_found"
        | "validation"
        | "invalid_state"
        | "not_seated";
    };

// Producer-marked check-in (MVP attendance rule: never auto-detected).
// Idempotent: marking the same outcome twice returns already. Flipping between
// attended and no_show is an allowed correction until the event is finalized.
// Marking attended runs the Rung-2 standing gate (a qualifying action).
export const checkIn = mutation({
  args: {
    // The desk always operates ONE event: a pass code from a different live
    // event must never mark attendance elsewhere (integration fix, 2026-07-07).
    eventId: v.id("events"),
    checkinCode: v.optional(v.string()),
    registrationId: v.optional(v.id("eventRegistrations")),
    outcome: v.union(v.literal("attended"), v.literal("no_show")),
  },
  handler: async (ctx, args): Promise<CheckInResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    // Exactly one lookup key: a scanned code or a picked row, never both.
    if ((args.checkinCode === undefined) === (args.registrationId === undefined)) {
      return { ok: false, error: "validation" };
    }
    const reg =
      args.checkinCode !== undefined
        ? await ctx.db
            .query("eventRegistrations")
            .withIndex("by_checkin_code", (q) =>
              q.eq("checkin_code", args.checkinCode as string),
            )
            .unique()
        : await ctx.db.get(args.registrationId as Id<"eventRegistrations">);
    if (reg === null || reg.state === "cancelled" || reg.event_id !== args.eventId) {
      return { ok: false, error: "not_found" };
    }
    // Only a SEAT HOLDER can be checked in: registered (attending), or an
    // attended/no_show row being corrected. A waitlisted member never got a
    // seat, so marking her attended would hand out attendance evidence and
    // Active-standing credit while bypassing the capacity/lane/lifecycle
    // checks the promotion path enforces (Gate 4 round 8). She must be
    // promoted through cancelMyRsvp's freed-seat path first.
    if (
      reg.state !== "registered" &&
      reg.state !== "attended" &&
      reg.state !== "no_show"
    ) {
      return { ok: false, error: "not_seated" };
    }
    const event = await ctx.db.get(reg.event_id);
    if (event === null) {
      return { ok: false, error: "not_found" };
    }
    // attendance_finalized closes the event to further marking; draft and
    // cancelled events have no check-in desk.
    if (event.state !== "published" && event.state !== "postponed") {
      return { ok: false, error: "invalid_state" };
    }
    if (reg.state === args.outcome) {
      return { ok: true, already: true, state: args.outcome };
    }
    const before = reg.state;
    await ctx.db.patch(reg._id, {
      state: args.outcome,
      updated_at: Date.now(),
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "checkIn",
      target_id: reg.member_id,
      before_summary: `event=${event._id} state=${before}`,
      after_summary: `event=${event._id} state=${args.outcome}`,
      source: "admin_fallback",
    });
    if (args.outcome === "attended") {
      // Engagement KPI (activity-log spec §B.7): attended only, never
      // no-show. Once per member per EVENT, so a no_show correction marked
      // back to attended never double-counts, while her next event does.
      await logActivityOnce(ctx, reg.member_id, "event_checked_in", event._id);
      await maybePromoteToActive(ctx, reg.member_id, "attended an event");
    }
    return { ok: true, state: args.outcome };
  },
});

// Close the event: attendance is final (producer-marked, Workshop System).
export const finalizeAttendance = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args): Promise<StateChangeResult> => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      return { ok: false, error: "not_found" };
    }
    if (event.state === "attendance_finalized") {
      return { ok: true, already: true };
    }
    if (event.state !== "published" && event.state !== "postponed") {
      return { ok: false, error: "invalid_state" };
    }
    const before = event.state;
    await ctx.db.patch(event._id, { state: "attendance_finalized" });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "finalizeAttendance",
      target_id: event._id,
      before_summary: `state=${before}`,
      after_summary: "state=attendance_finalized",
      source: "admin_fallback",
    });
    return { ok: true };
  },
});
