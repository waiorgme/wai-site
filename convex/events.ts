import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { logActivityOnce } from "./lib/activity";
import { notify } from "./lib/notify";
import { currentStanding } from "./lib/standing";

// Member-facing events (panel-experience spec §A; vault: Workshop System,
// Event Cadence, PRD Phase 3 §7.5, Stage 0 §4.5). Everything here is keyed off
// the AUTHENTICATED member, never a caller-supplied member id, and the youth
// lane rule is enforced server-side on every read and write: minors and
// restricted_unknown members only ever see audience_lane "youth" events,
// "switched off, not supervised". No response ever carries another member's
// data, only aggregate counts.

// Recent past window for the list: the last 60 days of delivered events stay
// visible (attendance, recordings), older ones drop off the member surface.
const RECENT_PAST_MS = 60 * 24 * 60 * 60 * 1000;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "12 June 2026" in GULF time (UTC+4, no DST), matching every portal surface
// (src/portal/format.ts uses Asia/Dubai). Hand formatting because the Convex
// runtime's Intl is limited. Shared with the admin notifications.
const GST_OFFSET_MS = 4 * 60 * 60 * 1000;
export const eventDateLabel = (ts: number): string => {
  const d = new Date(ts + GST_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// The lane rule in one place, TWO-WAY: confirmed minors see ONLY youth
// events, adult lanes see ONLY adult events, and restricted_unknown sees
// NONE - an unconfirmed age could be anyone, so she belongs in neither an
// under-18 room nor an adult one until her date of birth is confirmed
// (Stage 0 safety default; Gate 4 round 4). The admin editor promises youth
// sessions are under-18 only, and the operational safeguards (vetted
// volunteers, two-adult rule) are for staff, not walk-in attendees.
export const laneSeesEvent = (
  lane: Doc<"members">["member_lane"],
  audience: "adult" | "youth",
): boolean =>
  lane === "minor"
    ? audience === "youth"
    : lane === "restricted_unknown"
      ? false
      : audience === "adult";

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

type RegistrationState = Doc<"eventRegistrations">["state"];

const countByState = async (
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
  state: RegistrationState,
): Promise<number> => {
  const rows = await ctx.db
    .query("eventRegistrations")
    .withIndex("by_event_state", (q) =>
      q.eq("event_id", eventId).eq("state", state),
    )
    .collect();
  return rows.length;
};

const myRegistration = async (
  ctx: QueryCtx | MutationCtx,
  memberId: Id<"members">,
  eventId: Id<"events">,
): Promise<Doc<"eventRegistrations"> | null> =>
  ctx.db
    .query("eventRegistrations")
    .withIndex("by_member_event", (q) =>
      q.eq("member_id", memberId).eq("event_id", eventId),
    )
    .unique();

// Her registration state for display: a cancelled row reads as "not registered".
const myState = (
  reg: Doc<"eventRegistrations"> | null,
): RegistrationState | null =>
  reg === null || reg.state === "cancelled" ? null : reg.state;

export type MemberEventRow = {
  eventId: Id<"events">;
  title: string;
  category: Doc<"events">["category"];
  short_description: string;
  starts_at: number;
  ends_at: number;
  timezone: string;
  format: "online" | "in_person";
  venue: string | null;
  city: string | null;
  host_name: string | null;
  audience_lane: "adult" | "youth";
  // The list only ever carries published/postponed (index-filtered); the
  // detail view reuses this row shape and may carry any non-draft state.
  state: Doc<"events">["state"];
  capacity: number | null;
  registered_count: number;
  waitlist_count: number;
  registration_closes_at: number | null;
  priority_window_start: number | null;
  priority_window_end: number | null;
  my_state: RegistrationState | null;
  is_past: boolean;
};

const toMemberRow = async (
  ctx: QueryCtx,
  event: Doc<"events">,
  memberId: Id<"members">,
  now: number,
): Promise<MemberEventRow> => ({
  eventId: event._id,
  title: event.title,
  category: event.category,
  short_description: event.short_description,
  starts_at: event.starts_at,
  ends_at: event.ends_at,
  timezone: event.timezone,
  format: event.format,
  venue: event.venue ?? null,
  city: event.city ?? null,
  host_name: event.host_name ?? null,
  audience_lane: event.audience_lane,
  state: event.state,
  capacity: event.capacity ?? null,
  registered_count: await countByState(ctx, event._id, "registered"),
  waitlist_count: await countByState(ctx, event._id, "waitlisted"),
  registration_closes_at: event.registration_closes_at ?? null,
  priority_window_start: event.priority_window_start ?? null,
  priority_window_end: event.priority_window_end ?? null,
  my_state: myState(await myRegistration(ctx, memberId, event._id)),
  // Past means ENDED: a two-hour session that started ten minutes ago is
  // live, not history - exactly when an online attendee hunts for the join
  // link (design sweep, 2026-07-07). New RSVPs still close at starts_at.
  is_past: event.ends_at < now,
});

// The member events list: published and postponed events, upcoming first, plus
// the recent past 60 days. Lane-aware server-side. Each row carries HER OWN
// registration state and aggregate counts only.
export const listEvents = query({
  args: {},
  handler: async (ctx): Promise<MemberEventRow[] | null> => {
    const member = await memberForAuthedUser(ctx);
    // Member surfaces open only at `active` (a pending_guardian minor or a
    // pending_review unknown-age account stays unusable until her human step).
    if (member === null || member.lifecycle_state !== "active") {
      return null;
    }
    const now = Date.now();
    const horizon = now - RECENT_PAST_MS;
    const events: Doc<"events">[] = [];
    // attendance_finalized stays on the board too: finalizing attendance
    // must not vanish a delivered event from "Recent past events" (the
    // 60-day promise above) or cut off recordings and the Attended mark.
    for (const state of ["published", "postponed", "attendance_finalized"] as const) {
      const batch = await ctx.db
        .query("events")
        .withIndex("by_state_start", (q) =>
          q.eq("state", state).gte("starts_at", horizon),
        )
        .collect();
      events.push(...batch);
    }
    const visible = events.filter((e) =>
      laneSeesEvent(member.member_lane, e.audience_lane),
    );
    // The upcoming/past split matches is_past: ended events are history,
    // a session underway still lists as upcoming.
    const upcoming = visible
      .filter((e) => e.ends_at >= now)
      .sort((a, b) => a.starts_at - b.starts_at);
    const past = visible
      .filter((e) => e.ends_at < now)
      .sort((a, b) => b.starts_at - a.starts_at);
    const rows: MemberEventRow[] = [];
    for (const event of [...upcoming, ...past]) {
      rows.push(await toMemberRow(ctx, event, member._id, now));
    }
    return rows;
  },
});

export type MemberEventDetail = MemberEventRow & {
  description: string | null;
  // Gated: only a registered or attended member gets the join link and the
  // post-event recording/materials (members-only, never public).
  meeting_link: string | null;
  recording_url: string | null;
  materials_url: string | null;
  cancelled_reason: string | null;
};

// One event, same lane rule. Draft events do not exist for members; cancelled
// and finalized ones stay readable (honest history) minus the gated links.
export const getEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args): Promise<MemberEventDetail | null> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null || member.lifecycle_state !== "active") {
      return null;
    }
    const event = await ctx.db.get(args.eventId);
    if (
      event === null ||
      event.state === "draft" ||
      !laneSeesEvent(member.member_lane, event.audience_lane)
    ) {
      return null;
    }
    const now = Date.now();
    const reg = await myRegistration(ctx, member._id, event._id);
    const state = myState(reg);
    const linked = state === "registered" || state === "attended";
    return {
      ...(await toMemberRow(ctx, event, member._id, now)),
      description: event.description ?? null,
      meeting_link: linked ? (event.meeting_link ?? null) : null,
      recording_url: linked ? (event.recording_url ?? null) : null,
      materials_url: linked ? (event.materials_url ?? null) : null,
      cancelled_reason: event.cancelled_reason ?? null,
    };
  },
});

type RsvpResult =
  | { ok: true; state: "registered" | "waitlisted"; already?: true }
  | {
      ok: false;
      error:
        | "not_signed_in"
        | "not_active"
        | "not_found"
        | "closed"
        | "priority_window";
    };

// One-tap RSVP with seat cap and automatic waitlist (PRD §7.5). Idempotent per
// member and event; a cancelled row is reused so one member never holds two
// rows for one event.
export const rsvp = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args): Promise<RsvpResult> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return { ok: false, error: "not_signed_in" };
    }
    if (member.lifecycle_state !== "active") {
      return { ok: false, error: "not_active" };
    }
    const event = await ctx.db.get(args.eventId);
    // Lane rule enforced on the WRITE too, and neutrally: an event she may not
    // see does not exist for her, same as a draft or a bogus id.
    if (
      event === null ||
      event.state === "draft" ||
      !laneSeesEvent(member.member_lane, event.audience_lane)
    ) {
      return { ok: false, error: "not_found" };
    }
    const now = Date.now();
    // Postponed events run on their new date and keep taking RSVPs: nothing
    // re-publishes a postponed event, so refusing here would strand it
    // (integration fix, 2026-07-06).
    if (event.state !== "published" && event.state !== "postponed") {
      return { ok: false, error: "closed" };
    }
    if (now >= event.starts_at) {
      return { ok: false, error: "closed" };
    }
    if (
      event.registration_closes_at !== undefined &&
      now >= event.registration_closes_at
    ) {
      return { ok: false, error: "closed" };
    }

    // Idempotency first, so a member already holding a seat is never bounced
    // by the priority window on a double tap.
    const existing = await myRegistration(ctx, member._id, event._id);
    if (existing !== null && existing.state !== "cancelled") {
      const state =
        existing.state === "waitlisted" ? "waitlisted" : "registered";
      return { ok: true, already: true, state };
    }

    // Priority window (Event Cadence decision): while it is open only standing
    // Active Member and above may take a seat. A plain member gets a named
    // refusal the UI explains in plain words, and we deliberately do NOT put
    // her on the waitlist during the window: the waitlist exists to backfill
    // freed seats, and at window end there is nothing to promote her into, so
    // a window-time waitlist entry would just jump the queue of members who
    // RSVP the moment seats open.
    if (
      event.priority_window_start !== undefined &&
      event.priority_window_end !== undefined &&
      now >= event.priority_window_start &&
      now < event.priority_window_end &&
      currentStanding(member) === "member"
    ) {
      return { ok: false, error: "priority_window" };
    }

    // Seat logic: below capacity (or uncapped) takes a seat, otherwise the
    // automatic waitlist.
    const registeredCount = await countByState(ctx, event._id, "registered");
    const seatFree =
      event.capacity === undefined || registeredCount < event.capacity;
    const state: "registered" | "waitlisted" = seatFree
      ? "registered"
      : "waitlisted";

    if (existing !== null) {
      // Re-RSVP after cancel reuses her row (one row per member per event).
      // The checkin_code stays: it is hers and still unguessable.
      await ctx.db.patch(existing._id, {
        state,
        promoted_from_waitlist_at: undefined,
        updated_at: now,
      });
    } else {
      // Unguessable check-in code, the QR pass and check-in desk key (same
      // 128-bit pattern as the certificate verify_token).
      await ctx.db.insert("eventRegistrations", {
        event_id: event._id,
        member_id: member._id,
        state,
        checkin_code: crypto.randomUUID().replace(/-/g, ""),
        created_at: now,
      });
    }

    await writeAudit(ctx, {
      actor: member.email,
      role: "member",
      action: "rsvp",
      target_id: member._id,
      after_summary: `event=${event._id} state=${state}`,
      source: "member",
    });

    // Engagement KPI (activity-log spec §B.7): registered or waitlisted,
    // she raised her hand either way. Once per event, however often she
    // cancels and rebooks.
    await logActivityOnce(ctx, member._id, "rsvp_confirmed", event._id);

    const dateLabel = eventDateLabel(event.starts_at);
    if (state === "registered") {
      await notify(
        ctx,
        member._id,
        "event_rsvp",
        `You're registered: ${event.title}`,
        `Your seat is confirmed for ${event.title} on ${dateLabel}. Open the session in Events to see your pass.`,
        "/portal#events",
      );
    } else {
      // No queue-position promises: honest, plain words only.
      await notify(
        ctx,
        member._id,
        "event_rsvp",
        `You're on the waitlist: ${event.title}`,
        `${event.title} on ${dateLabel} is full right now. You're on the waitlist, we'll tell you the moment a seat opens.`,
        "/portal#events",
      );
    }

    return { ok: true, state };
  },
});

// When a registered seat frees, the EARLIEST waitlisted member (by created_at)
// auto-promotes: audited and notified (PRD §7.5 acceptance). Shared by the
// member cancel path; runs only for a live, upcoming, published event.
const promoteEarliestWaitlisted = async (
  ctx: MutationCtx,
  event: Doc<"events">,
  now: number,
): Promise<void> => {
  if (
    (event.state !== "published" && event.state !== "postponed") ||
    event.starts_at <= now
  ) {
    return;
  }
  const waitlisted = await ctx.db
    .query("eventRegistrations")
    .withIndex("by_event_state", (q) =>
      q.eq("event_id", event._id).eq("state", "waitlisted"),
    )
    .collect();
  if (waitlisted.length === 0) {
    return;
  }
  const next = waitlisted.reduce((a, b) =>
    b.created_at < a.created_at ? b : a,
  );
  await ctx.db.patch(next._id, {
    state: "registered",
    promoted_from_waitlist_at: now,
    updated_at: now,
  });
  await writeAudit(ctx, {
    actor: "system",
    role: "system",
    action: "promoteFromWaitlist",
    target_id: next.member_id,
    after_summary: `event=${event._id} waitlisted -> registered`,
    source: "system",
  });
  await notify(
    ctx,
    next.member_id,
    "event_waitlist_promoted",
    `A seat opened: ${event.title}`,
    `Good news. A seat opened up and you're now registered for ${event.title} on ${eventDateLabel(event.starts_at)}. Open the session in Events to see your pass.`,
    "/portal#events",
  );
};

type CancelRsvpResult =
  | { ok: true; already?: true }
  | { ok: false; error: "not_signed_in" | "not_found" | "invalid_state" };

// Cancel my RSVP. Freeing a seat immediately promotes the earliest waitlisted
// member.
export const cancelMyRsvp = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args): Promise<CancelRsvpResult> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return { ok: false, error: "not_signed_in" };
    }
    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      return { ok: false, error: "not_found" };
    }
    const reg = await myRegistration(ctx, member._id, event._id);
    if (reg === null) {
      return { ok: false, error: "not_found" };
    }
    if (reg.state === "cancelled") {
      return { ok: true, already: true };
    }
    // Attendance already marked (attended / no_show) is history, not a booking.
    if (reg.state !== "registered" && reg.state !== "waitlisted") {
      return { ok: false, error: "invalid_state" };
    }
    const now = Date.now();
    const freedSeat = reg.state === "registered";
    await ctx.db.patch(reg._id, { state: "cancelled", updated_at: now });
    await writeAudit(ctx, {
      actor: member.email,
      role: "member",
      action: "cancelMyRsvp",
      target_id: member._id,
      before_summary: `event=${event._id} state=${reg.state}`,
      after_summary: `event=${event._id} state=cancelled`,
      source: "member",
    });
    if (freedSeat) {
      await promoteEarliestWaitlisted(ctx, event, now);
    }
    return { ok: true };
  },
});

export type MyEventRow = {
  eventId: Id<"events">;
  title: string;
  category: Doc<"events">["category"];
  starts_at: number;
  ends_at: number;
  timezone: string;
  format: "online" | "in_person";
  venue: string | null;
  city: string | null;
  event_state: Doc<"events">["state"];
  my_state: RegistrationState;
  is_past: boolean;
};

// My events: her own registrations joined with their events, upcoming and past
// including attendance outcomes. Cancelled RSVPs are not listed.
export const myEvents = query({
  args: {},
  handler: async (ctx): Promise<MyEventRow[] | null> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null || member.lifecycle_state !== "active") {
      return null;
    }
    const now = Date.now();
    const regs = await ctx.db
      .query("eventRegistrations")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .collect();
    const rows: MyEventRow[] = [];
    for (const reg of regs) {
      if (reg.state === "cancelled") {
        continue;
      }
      const event = await ctx.db.get(reg.event_id);
      // Lane re-check (defense in depth): should a member's lane ever change
      // after booking, rows her lane may not see disappear with it.
      if (
        event === null ||
        event.state === "draft" ||
        !laneSeesEvent(member.member_lane, event.audience_lane)
      ) {
        continue;
      }
      rows.push({
        eventId: event._id,
        title: event.title,
        category: event.category,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        timezone: event.timezone,
        format: event.format,
        venue: event.venue ?? null,
        city: event.city ?? null,
        event_state: event.state,
        my_state: reg.state,
        // Same rule as the board: past means ENDED, not started.
        is_past: event.ends_at < now,
      });
    }
    rows.sort((a, b) => a.starts_at - b.starts_at);
    return rows;
  },
});

export type MyEventPass = {
  memberName: string;
  // From her VALID membership certificate; null when none is issued yet.
  membershipNumber: number | null;
  checkin_code: string;
  title: string;
  starts_at: number;
  timezone: string;
  format: "online" | "in_person";
  venue: string | null;
  city: string | null;
};

// The event pass (QR of the check-in code). Only her own registered or
// attended row produces a pass; nothing here is queryable for other members.
export const getMyEventPass = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args): Promise<MyEventPass | null> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null || member.lifecycle_state !== "active") {
      return null;
    }
    const event = await ctx.db.get(args.eventId);
    if (
      event === null ||
      event.state === "draft" ||
      !laneSeesEvent(member.member_lane, event.audience_lane)
    ) {
      return null;
    }
    const reg = await myRegistration(ctx, member._id, event._id);
    if (reg === null || (reg.state !== "registered" && reg.state !== "attended")) {
      return null;
    }
    const certs = await ctx.db
      .query("certificates")
      .withIndex("by_member", (q) => q.eq("member_id", member._id))
      .collect();
    const membership = certs.find(
      (c) => c.type === "membership" && c.status === "valid",
    );
    return {
      memberName: member.name,
      membershipNumber: membership?.membership_number ?? null,
      checkin_code: reg.checkin_code,
      title: event.title,
      starts_at: event.starts_at,
      timezone: event.timezone,
      format: event.format,
      venue: event.venue ?? null,
      city: event.city ?? null,
    };
  },
});
