import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// Events domain integration tests (panel-experience spec §A, Gate 5): lane
// gating, seat cap + waitlist + auto-promotion, priority window, closed
// registration, idempotent RSVP and check-in, link gating, the event pass,
// standing promotion on attendance, and deny-by-default on every admin
// function. Same convex-test idioms as adminPanel.test.ts.

const modules = import.meta.glob("../../convex/**/*.*s");

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => ({ error: null }),
    };
  },
}));

const ADMIN_EMAIL = "issam@example.com";
const NON_ADMIN = "member@example.com";

beforeEach(() => {
  process.env.SUPER_ADMIN_EMAILS = ADMIN_EMAIL;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  process.env.AUTH_RESEND_KEY = "test-key";
  process.env.SITE_URL = "http://localhost:4321";
});

afterEach(() => {
  vi.restoreAllMocks();
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Schema-typed tester, so helpers keep the named indexes in t.run queries.
type Tester = TestConvex<typeof schema>;

const memberRow = (email: string, extra: Record<string, unknown> = {}) => ({
  email,
  name: "Test Member",
  source: "new_signup" as const,
  lifecycle_state: "active" as const,
  date_of_birth: "1985-03-10",
  date_of_birth_source: "self_declared" as const,
  age_confidence: "declared" as const,
  guardian_consent_state: "not_required" as const,
  gender: "female" as const,
  career_stage_answer: "Working in aviation",
  member_lane: "standard" as const,
  created_at: Date.now(),
  ...extra,
});

const signIn = async (
  t: ReturnType<typeof convexTest>,
  email: string,
  extra: Record<string, unknown> = {},
) => {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { ...memberRow(email, extra), userId });
  });
  return t.withIdentity({ subject: `${userId}|testsession` });
};

const memberByEmail = async (t: Tester, email: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique(),
  );

const eventRow = (extra: Record<string, unknown> = {}) => ({
  title: "How I Got In: Story Session",
  category: "story_session" as const,
  short_description: "A member shares her path into aviation, with Q&A.",
  starts_at: Date.now() + 7 * DAY,
  ends_at: Date.now() + 7 * DAY + HOUR,
  timezone: "GST",
  format: "online" as const,
  meeting_link: "https://meet.example.com/session",
  audience_lane: "adult" as const,
  state: "published" as const,
  created_at: Date.now(),
  published_at: Date.now(),
  ...extra,
});

const insertEvent = async (
  t: ReturnType<typeof convexTest>,
  extra: Record<string, unknown> = {},
) =>
  t.run(async (ctx) =>
    ctx.db.insert("events", eventRow(extra) as never),
  ) as Promise<Id<"events">>;

const regsForEvent = async (t: Tester, eventId: Id<"events">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("eventRegistrations")
      .withIndex("by_event_state", (q) => q.eq("event_id", eventId))
      .collect(),
  );

const notificationsFor = async (t: Tester, memberId: Id<"members">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_member_time", (q) => q.eq("member_id", memberId))
      .collect(),
  );

// Full argument set for upsertEvent (mutation args are exact). Times are
// computed ONCE at module load so every upsertArgs() call shares identical
// values: live-event edits lock their times server-side, and per-call
// Date.now() could cross a minute boundary and trip that lock spuriously.
const UPSERT_STARTS = Date.now() + 10 * DAY;
const upsertArgs = (extra: Record<string, unknown> = {}) => ({
  title: "Skills Clinic: CVs That Land",
  category: "skills_clinic" as const,
  short_description: "Bring your CV, leave with a sharper one.",
  starts_at: UPSERT_STARTS,
  ends_at: UPSERT_STARTS + 2 * HOUR,
  format: "online" as const,
  audience_lane: "adult" as const,
  ...extra,
});

describe("lane gating (switched off, not supervised)", () => {
  it("minor and restricted_unknown lanes see ONLY youth events; adult lanes see ONLY adult events", async () => {
    const t = convexTest(schema, modules);
    await insertEvent(t, { title: "Adult Workshop" });
    const youthEventId = await insertEvent(t, {
      title: "Girls in Aviation Day",
      audience_lane: "youth",
    });

    const asMinor = await signIn(t, "minor@example.com", {
      member_lane: "minor",
      date_of_birth: "2011-05-01",
      guardian_consent_state: "confirmed",
    });
    const minorList = await asMinor.query(api.events.listEvents, {});
    expect(minorList).not.toBeNull();
    expect(minorList!.map((e) => e.title)).toEqual(["Girls in Aviation Day"]);

    // restricted_unknown sees NOTHING (Gate 4 round 4): an unconfirmed age
    // could be anyone, so she belongs in neither room until DOB is confirmed.
    const asUnknown = await signIn(t, "unknown@example.com", {
      member_lane: "restricted_unknown",
      date_of_birth: undefined,
      age_confidence: "unknown",
      date_of_birth_source: "unknown",
    });
    const unknownList = await asUnknown.query(api.events.listEvents, {});
    expect(unknownList).toEqual([]);
    expect(
      await asUnknown.query(api.events.getEvent, { eventId: youthEventId }),
    ).toBeNull();
    expect(
      await asUnknown.mutation(api.events.rsvp, { eventId: youthEventId }),
    ).toEqual({ ok: false, error: "not_found" });

    // Two-way rule (2026-07-07): an under-18 session takes no bookings from
    // adult members - the youth board is hers alone, and vice versa.
    const asStandard = await signIn(t, "standard@example.com");
    const standardList = await asStandard.query(api.events.listEvents, {});
    expect(standardList!.map((e) => e.title)).toEqual(["Adult Workshop"]);

    // The direct RSVP write is refused too, and leaves nothing behind.
    const res = await asStandard.mutation(api.events.rsvp, {
      eventId: youthEventId,
    });
    expect(res).toEqual({ ok: false, error: "not_found" });
    expect(await regsForEvent(t, youthEventId)).toHaveLength(0);
  });

  it("a minor's direct RSVP to an adult event is refused server-side and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t);
    const asMinor = await signIn(t, "minor@example.com", {
      member_lane: "minor",
      date_of_birth: "2011-05-01",
      guardian_consent_state: "confirmed",
    });
    const res = await asMinor.mutation(api.events.rsvp, { eventId });
    expect(res).toEqual({ ok: false, error: "not_found" });
    expect(await regsForEvent(t, eventId)).toHaveLength(0);
    // getEvent is lane-gated too: the adult event does not exist for her.
    expect(await asMinor.query(api.events.getEvent, { eventId })).toBeNull();
  });
});

describe("rsvp: seats, waitlist, idempotency", () => {
  it("fills the cap, then waitlists, with honest notifications and counts", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, { capacity: 1 });
    const asA = await signIn(t, "a@example.com");
    const asB = await signIn(t, "b@example.com");

    expect(await asA.mutation(api.events.rsvp, { eventId })).toEqual({
      ok: true,
      state: "registered",
    });
    expect(await asB.mutation(api.events.rsvp, { eventId })).toEqual({
      ok: true,
      state: "waitlisted",
    });

    const list = await asA.query(api.events.listEvents, {});
    expect(list![0].registered_count).toBe(1);
    expect(list![0].waitlist_count).toBe(1);
    expect(list![0].my_state).toBe("registered");

    const memberA = await memberByEmail(t, "a@example.com");
    const memberB = await memberByEmail(t, "b@example.com");
    const aNotes = await notificationsFor(t, memberA!._id);
    expect(aNotes).toHaveLength(1);
    expect(aNotes[0].type).toBe("event_rsvp");
    expect(aNotes[0].title).toContain("registered");
    expect(aNotes[0].body).toContain("How I Got In");
    const bNotes = await notificationsFor(t, memberB!._id);
    expect(bNotes[0].body).toContain(
      "we'll tell you the moment a seat opens",
    );
    // No queue-position promises anywhere.
    expect(bNotes[0].body).not.toMatch(/position|number \d+ in/i);

    // Member RSVP is audited (member source).
    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "rsvp"))
        .collect(),
    );
    expect(audits).toHaveLength(2);
    expect(audits[0].source).toBe("member");
  });

  it("rsvp is idempotent per member and event", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t);
    const asA = await signIn(t, "a@example.com");
    await asA.mutation(api.events.rsvp, { eventId });
    const again = await asA.mutation(api.events.rsvp, { eventId });
    expect(again).toEqual({ ok: true, already: true, state: "registered" });
    expect(await regsForEvent(t, eventId)).toHaveLength(1);
    // No duplicate notification on the double tap.
    const memberA = await memberByEmail(t, "a@example.com");
    expect(await notificationsFor(t, memberA!._id)).toHaveLength(1);
  });

  it("cancel frees the seat and the EARLIEST waitlisted member auto-promotes, audited + notified", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, { capacity: 1 });
    const asA = await signIn(t, "a@example.com");
    const asB = await signIn(t, "b@example.com");
    const asC = await signIn(t, "c@example.com");
    await asA.mutation(api.events.rsvp, { eventId });
    await asB.mutation(api.events.rsvp, { eventId });
    // C joins the waitlist after B: B must be the one promoted.
    await t.run(async (ctx) => {
      const reg = await ctx.db
        .query("eventRegistrations")
        .withIndex("by_event_state", (q) =>
          q.eq("event_id", eventId).eq("state", "waitlisted"),
        )
        .unique();
      // Push B's created_at clearly before C's.
      await ctx.db.patch(reg!._id, { created_at: Date.now() - HOUR });
    });
    await asC.mutation(api.events.rsvp, { eventId });

    expect(await asA.mutation(api.events.cancelMyRsvp, { eventId })).toEqual({
      ok: true,
    });

    const memberB = await memberByEmail(t, "b@example.com");
    const memberC = await memberByEmail(t, "c@example.com");
    const regs = await regsForEvent(t, eventId);
    const bReg = regs.find((r) => r.member_id === memberB!._id);
    const cReg = regs.find((r) => r.member_id === memberC!._id);
    expect(bReg?.state).toBe("registered");
    expect(bReg?.promoted_from_waitlist_at).toBeDefined();
    expect(cReg?.state).toBe("waitlisted");

    const promoAudit = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "promoteFromWaitlist"))
        .collect(),
    );
    expect(promoAudit).toHaveLength(1);
    expect(promoAudit[0].source).toBe("system");
    expect(promoAudit[0].target_id).toBe(memberB!._id);

    const bNotes = await notificationsFor(t, memberB!._id);
    const promoted = bNotes.find((n) => n.type === "event_waitlist_promoted");
    expect(promoted).toBeDefined();
    expect(promoted!.body).toContain("you're now registered");
  });

  it("re-RSVP after cancel reuses the same row (one row per member per event)", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, { capacity: 1 });
    const asA = await signIn(t, "a@example.com");
    const asB = await signIn(t, "b@example.com");
    await asA.mutation(api.events.rsvp, { eventId });
    await asB.mutation(api.events.rsvp, { eventId });
    await asA.mutation(api.events.cancelMyRsvp, { eventId });
    // B was promoted into the only seat; A returns and lands on the waitlist.
    const back = await asA.mutation(api.events.rsvp, { eventId });
    expect(back).toEqual({ ok: true, state: "waitlisted" });
    const memberA = await memberByEmail(t, "a@example.com");
    const regs = await regsForEvent(t, eventId);
    expect(regs.filter((r) => r.member_id === memberA!._id)).toHaveLength(1);
    // Cancelling twice is a harmless already.
    await asA.mutation(api.events.cancelMyRsvp, { eventId });
    expect(await asA.mutation(api.events.cancelMyRsvp, { eventId })).toEqual({
      ok: true,
      already: true,
    });
  });
});

describe("priority window (Active Member and above go first)", () => {
  it("refuses a plain member during the window, with NO waitlist entry", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, {
      capacity: 10,
      priority_window_start: Date.now() - HOUR,
      priority_window_end: Date.now() + HOUR,
    });
    const asPlain = await signIn(t, "plain@example.com");
    const res = await asPlain.mutation(api.events.rsvp, { eventId });
    expect(res).toEqual({ ok: false, error: "priority_window" });
    // Nothing written: no seat, no waitlist row.
    expect(await regsForEvent(t, eventId)).toHaveLength(0);
  });

  it("admits active_member standing during the window", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, {
      priority_window_start: Date.now() - HOUR,
      priority_window_end: Date.now() + HOUR,
    });
    const asActive = await signIn(t, "active@example.com", {
      standing: "active_member",
    });
    expect(await asActive.mutation(api.events.rsvp, { eventId })).toEqual({
      ok: true,
      state: "registered",
    });
  });

  it("admits a plain member once the window has closed", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, {
      priority_window_start: Date.now() - 2 * DAY,
      priority_window_end: Date.now() - DAY,
    });
    const asPlain = await signIn(t, "plain@example.com");
    expect(await asPlain.mutation(api.events.rsvp, { eventId })).toEqual({
      ok: true,
      state: "registered",
    });
  });
});

describe("closed or unavailable registration", () => {
  it("refuses past registration_closes_at, past start, non-published states, drafts", async () => {
    const t = convexTest(schema, modules);
    const asA = await signIn(t, "a@example.com");

    const closed = await insertEvent(t, {
      registration_closes_at: Date.now() - HOUR,
    });
    expect(await asA.mutation(api.events.rsvp, { eventId: closed })).toEqual({
      ok: false,
      error: "closed",
    });

    const started = await insertEvent(t, {
      starts_at: Date.now() - HOUR,
      ends_at: Date.now() + HOUR,
    });
    expect(await asA.mutation(api.events.rsvp, { eventId: started })).toEqual({
      ok: false,
      error: "closed",
    });

    const cancelled = await insertEvent(t, {
      state: "cancelled",
      cancelled_reason: "Host unavailable",
    });
    expect(await asA.mutation(api.events.rsvp, { eventId: cancelled })).toEqual(
      { ok: false, error: "closed" },
    );

    // A draft does not exist for members at all (neutral not_found).
    const draft = await insertEvent(t, { state: "draft", published_at: undefined });
    expect(await asA.mutation(api.events.rsvp, { eventId: draft })).toEqual({
      ok: false,
      error: "not_found",
    });
    const list = await asA.query(api.events.listEvents, {});
    expect(list!.map((e) => e.title)).not.toContain(undefined);
    expect(list!.some((e) => e.eventId === draft)).toBe(false);
  });

  it("refuses a member whose lifecycle is not active", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t);
    const asDormant = await signIn(t, "dormant@example.com", {
      lifecycle_state: "dormant",
    });
    expect(await asDormant.mutation(api.events.rsvp, { eventId })).toEqual({
      ok: false,
      error: "not_active",
    });
  });
});

describe("meeting link and post-event links are gated on her own state", () => {
  it("hides meeting_link/recording_url until she is registered", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, {
      capacity: 1,
      recording_url: "https://videos.example.com/rec",
      materials_url: "https://docs.example.com/slides",
    });
    const asA = await signIn(t, "a@example.com");
    const before = await asA.query(api.events.getEvent, { eventId });
    expect(before!.meeting_link).toBeNull();
    expect(before!.recording_url).toBeNull();
    expect(before!.materials_url).toBeNull();

    await asA.mutation(api.events.rsvp, { eventId });
    const after = await asA.query(api.events.getEvent, { eventId });
    expect(after!.meeting_link).toBe("https://meet.example.com/session");
    expect(after!.recording_url).toBe("https://videos.example.com/rec");
    expect(after!.my_state).toBe("registered");

    // A waitlisted member has no seat, so no link.
    const asB = await signIn(t, "b@example.com");
    await asB.mutation(api.events.rsvp, { eventId });
    const waitlisted = await asB.query(api.events.getEvent, { eventId });
    expect(waitlisted!.my_state).toBe("waitlisted");
    expect(waitlisted!.meeting_link).toBeNull();
  });
});

describe("my events + event pass", () => {
  it("myEvents lists her registrations with attendance; the pass carries her number and code", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t);
    const asA = await signIn(t, "a@example.com", { name: "Amal Haddad" });
    await asA.mutation(api.events.rsvp, { eventId });
    const memberA = await memberByEmail(t, "a@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("certificates", {
        member_id: memberA!._id,
        type: "membership",
        verify_token: "tok123",
        membership_number: 2042,
        recipient_name: "Amal Haddad",
        issued_at: Date.now(),
        issued_date_label: "1 July 2026",
        is_founding: true,
        status: "valid",
        template_version: "membership-2026-06",
        idempotency_key: `membership:${memberA!._id}`,
      });
    });

    const mine = await asA.query(api.events.myEvents, {});
    expect(mine).toHaveLength(1);
    expect(mine![0].my_state).toBe("registered");
    expect(mine![0].is_past).toBe(false);

    const pass = await asA.query(api.events.getMyEventPass, { eventId });
    expect(pass).not.toBeNull();
    expect(pass!.memberName).toBe("Amal Haddad");
    expect(pass!.membershipNumber).toBe(2042);
    const regs = await regsForEvent(t, eventId);
    expect(pass!.checkin_code).toBe(regs[0].checkin_code);
    expect(pass!.checkin_code.length).toBeGreaterThanOrEqual(32);

    // No registration, no pass.
    const asB = await signIn(t, "b@example.com");
    expect(await asB.query(api.events.getMyEventPass, { eventId })).toBeNull();
  });
});

describe("admin events: deny-by-default on every function", () => {
  it("a non-admin member is refused everywhere, neutrally", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t);
    const asMember = await signIn(t, NON_ADMIN);

    await expect(
      asMember.query(api.admin.events.adminListEvents, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asMember.query(api.admin.events.getEventAdmin, { eventId }),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asMember.query(api.admin.events.listRegistrations, { eventId }),
    ).rejects.toThrow(/not_authorized/);

    expect(
      await asMember.mutation(api.admin.events.upsertEvent, upsertArgs()),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.events.publishEvent, { eventId }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.events.cancelEvent, {
        eventId,
        reason: "nope",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.events.postponeEvent, {
        eventId,
        newStartsAt: Date.now() + DAY,
        newEndsAt: Date.now() + DAY + HOUR,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.events.setEventLinks, {
        eventId,
        recording_url: "https://x.example.com/r",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.events.checkIn, { eventId,
        checkinCode: "whatever",
        outcome: "attended",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.events.finalizeAttendance, { eventId }),
    ).toEqual({ ok: false, error: "not_authorized" });
  });

  it("an unauthenticated caller is refused on the queries", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.admin.events.adminListEvents, {})).rejects.toThrow(
      /not_authorized/,
    );
  });
});

describe("admin events: create, publish, cancel, postpone, links", () => {
  it("upsert creates a draft members cannot see; publish puts it on the board", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const asA = await signIn(t, "a@example.com");

    const created = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs(),
    );
    expect(created.ok).toBe(true);
    const eventId = (created as { ok: true; eventId: Id<"events"> }).eventId;

    expect(await asA.query(api.events.listEvents, {})).toEqual([]);
    expect(await asA.query(api.events.getEvent, { eventId })).toBeNull();

    const published = await asAdmin.mutation(api.admin.events.publishEvent, {
      eventId,
    });
    expect(published).toEqual({ ok: true });
    const again = await asAdmin.mutation(api.admin.events.publishEvent, {
      eventId,
    });
    expect(again).toEqual({ ok: true, already: true });

    const list = await asA.query(api.events.listEvents, {});
    expect(list).toHaveLength(1);
    expect(list![0].title).toBe("Skills Clinic: CVs That Land");
    // Default timezone label applied at the boundary.
    expect(list![0].timezone).toBe("GST");

    const adminList = await asAdmin.query(api.admin.events.adminListEvents, {});
    expect(adminList).toHaveLength(1);
    expect(adminList[0].state).toBe("published");
    expect(adminList[0].published_at).not.toBeNull();

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .withIndex("by_source_time", (q) => q.eq("source", "admin_fallback"))
        .collect(),
    );
    expect(audits.map((a) => a.action)).toEqual([
      "upsertEvent",
      "publishEvent",
    ]);
  });

  it("upsert refuses non-https meeting links at the boundary (Gate 4)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    // The link becomes a member-facing href: https only, bounded length.
    for (const bad of [
      "http://meet.example.com/x",
      "javascript:alert(1)",
      `https://meet.example.com/${"x".repeat(500)}`,
    ]) {
      expect(
        await asAdmin.mutation(
          api.admin.events.upsertEvent,
          upsertArgs({ meeting_link: bad }),
        ),
      ).toEqual({ ok: false, error: "validation" });
    }
    const ok = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs({ meeting_link: "https://meet.example.com/session" }),
    );
    expect(ok.ok).toBe(true);
  });

  it("upsert validates times, capacity and the priority window", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    expect(
      await asAdmin.mutation(
        api.admin.events.upsertEvent,
        upsertArgs({ ends_at: Date.now() + 10 * DAY - HOUR }),
      ),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(
        api.admin.events.upsertEvent,
        upsertArgs({ capacity: 0 }),
      ),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(
        api.admin.events.upsertEvent,
        upsertArgs({ priority_window_start: Date.now() }),
      ),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(
        api.admin.events.upsertEvent,
        upsertArgs({ title: "   " }),
      ),
    ).toEqual({ ok: false, error: "validation" });
  });

  it("edits a published event with audit; refuses editing a cancelled one", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const eventId = await insertEvent(t);
    // A live edit keeps the event's own times (they are locked to the
    // Postpone path); the rename itself is normal operator work.
    const live = await t.run(async (ctx) => ctx.db.get(eventId));
    const edit = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs({
        eventId,
        title: "Renamed Session",
        starts_at: live!.starts_at,
        ends_at: live!.ends_at,
      }),
    );
    expect(edit).toEqual({ ok: true, eventId });
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.title).toBe("Renamed Session");
    expect(event?.state).toBe("published");

    const closedId = await insertEvent(t, {
      state: "cancelled",
      cancelled_reason: "done",
    });
    expect(
      await asAdmin.mutation(
        api.admin.events.upsertEvent,
        upsertArgs({ eventId: closedId }),
      ),
    ).toEqual({ ok: false, error: "invalid_state" });
  });

  it("cancelEvent notifies EVERY registered and waitlisted member with the reason, audited with the count", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const eventId = await insertEvent(t, { capacity: 1 });
    const asA = await signIn(t, "a@example.com");
    const asB = await signIn(t, "b@example.com");
    await asA.mutation(api.events.rsvp, { eventId });
    await asB.mutation(api.events.rsvp, { eventId });

    const res = await asAdmin.mutation(api.admin.events.cancelEvent, {
      eventId,
      reason: "The host is unwell",
    });
    expect(res).toEqual({ ok: true, notified: 2 });

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.state).toBe("cancelled");
    expect(event?.cancelled_reason).toBe("The host is unwell");

    for (const email of ["a@example.com", "b@example.com"]) {
      const member = await memberByEmail(t, email);
      const notes = await notificationsFor(t, member!._id);
      const update = notes.find((n) => n.type === "event_update");
      expect(update).toBeDefined();
      expect(update!.body).toContain("The host is unwell");
      expect(update!.title).toContain("Cancelled");
    }

    const audit = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "cancelEvent"))
        .collect(),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].after_summary).toContain("notified=2");
    // Cancelled events leave the member board.
    const list = await asA.query(api.events.listEvents, {});
    expect(list!.some((e) => e.eventId === eventId)).toBe(false);
    // But stay readable in detail, with the reason.
    const detail = await asA.query(api.events.getEvent, { eventId });
    expect(detail?.state).toBe("cancelled");
    expect(detail?.cancelled_reason).toBe("The host is unwell");
  });

  it("postponeEvent moves the times and tells booking holders; rsvp then refuses", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const eventId = await insertEvent(t);
    const asA = await signIn(t, "a@example.com");
    await asA.mutation(api.events.rsvp, { eventId });

    const newStart = Date.now() + 14 * DAY;
    const res = await asAdmin.mutation(api.admin.events.postponeEvent, {
      eventId,
      newStartsAt: newStart,
      newEndsAt: newStart + HOUR,
    });
    expect(res).toEqual({ ok: true, notified: 1 });
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.state).toBe("postponed");
    expect(event?.starts_at).toBe(newStart);

    const memberA = await memberByEmail(t, "a@example.com");
    const notes = await notificationsFor(t, memberA!._id);
    expect(notes.some((n) => n.title.includes("New date"))).toBe(true);

    // Postponed events stay visible AND keep taking RSVPs: the event runs on
    // its new date and nothing re-publishes it (integration fix, 2026-07-06).
    const asB = await signIn(t, "b@example.com");
    const list = await asB.query(api.events.listEvents, {});
    expect(list!.some((e) => e.eventId === eventId)).toBe(true);
    expect(await asB.mutation(api.events.rsvp, { eventId })).toEqual({
      ok: true,
      state: "registered",
    });
  });

  it("setEventLinks validates and audits", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const eventId = await insertEvent(t);
    expect(
      await asAdmin.mutation(api.admin.events.setEventLinks, {
        eventId,
        recording_url: "http://insecure.example.com",
      }),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(api.admin.events.setEventLinks, { eventId }),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(api.admin.events.setEventLinks, {
        eventId,
        recording_url: "https://videos.example.com/rec",
      }),
    ).toEqual({ ok: true });
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.recording_url).toBe("https://videos.example.com/rec");
    const audit = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "setEventLinks"))
        .collect(),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].after_summary).toContain("recording=true");
  });
});

describe("admin check-in and finalize", () => {
  it("listRegistrations shows names for the desk, never emails", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const eventId = await insertEvent(t);
    const asA = await signIn(t, "a@example.com", { name: "Amal Haddad" });
    await asA.mutation(api.events.rsvp, { eventId });
    const rows = await asAdmin.query(api.admin.events.listRegistrations, {
      eventId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Amal Haddad");
    expect(rows[0].state).toBe("registered");
    expect(JSON.stringify(rows)).not.toContain("@example.com");
  });

  it("checkIn by code is idempotent, audited, and allows the no_show correction", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const eventId = await insertEvent(t);
    const asA = await signIn(t, "a@example.com");
    await asA.mutation(api.events.rsvp, { eventId });
    const regs = await regsForEvent(t, eventId);
    const code = regs[0].checkin_code;

    // Exactly one lookup key is required.
    expect(
      await asAdmin.mutation(api.admin.events.checkIn, { eventId, outcome: "attended" }),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(api.admin.events.checkIn, { eventId,
        checkinCode: code,
        registrationId: regs[0]._id,
        outcome: "attended",
      }),
    ).toEqual({ ok: false, error: "validation" });

    expect(
      await asAdmin.mutation(api.admin.events.checkIn, { eventId,
        checkinCode: code,
        outcome: "attended",
      }),
    ).toEqual({ ok: true, state: "attended" });
    expect(
      await asAdmin.mutation(api.admin.events.checkIn, { eventId,
        checkinCode: code,
        outcome: "attended",
      }),
    ).toEqual({ ok: true, already: true, state: "attended" });
    // Correction by registration id.
    expect(
      await asAdmin.mutation(api.admin.events.checkIn, { eventId,
        registrationId: regs[0]._id,
        outcome: "no_show",
      }),
    ).toEqual({ ok: true, state: "no_show" });

    const audit = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "checkIn"))
        .collect(),
    );
    expect(audit).toHaveLength(2);
    // The check-in code never lands in the audit trail.
    expect(JSON.stringify(audit)).not.toContain(code);
  });

  it("checkIn with attended promotes standing when the profile is complete", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const eventId = await insertEvent(t);
    const photoId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["fake image bytes"])),
    );
    const asA = await signIn(t, "complete@example.com", {
      photo_storage_id: photoId,
      country_of_residence: "United Arab Emirates",
      function_area: "Flight Operations",
      profile_complete: true,
    });
    await asA.mutation(api.events.rsvp, { eventId });
    const regs = await regsForEvent(t, eventId);
    await asAdmin.mutation(api.admin.events.checkIn, { eventId,
      checkinCode: regs[0].checkin_code,
      outcome: "attended",
    });

    const member = await memberByEmail(t, "complete@example.com");
    expect(member?.standing).toBe("active_member");
    const history = await t.run(async (ctx) =>
      ctx.db
        .query("standingHistory")
        .withIndex("by_member_time", (q) => q.eq("member_id", member!._id))
        .collect(),
    );
    expect(history).toHaveLength(1);
    expect(history[0].to_standing).toBe("active_member");
    expect(history[0].reason).toContain("attended an event");
    const notes = await notificationsFor(t, member!._id);
    expect(notes.some((n) => n.type === "standing_change")).toBe(true);
  });

  it("checkIn does NOT promote standing while the profile is incomplete", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const eventId = await insertEvent(t);
    const asA = await signIn(t, "incomplete@example.com");
    await asA.mutation(api.events.rsvp, { eventId });
    const regs = await regsForEvent(t, eventId);
    await asAdmin.mutation(api.admin.events.checkIn, { eventId,
      checkinCode: regs[0].checkin_code,
      outcome: "attended",
    });
    const member = await memberByEmail(t, "incomplete@example.com");
    expect(member?.standing ?? "member").toBe("member");
  });

  it("finalizeAttendance closes the event to further check-ins", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const eventId = await insertEvent(t);
    const asA = await signIn(t, "a@example.com");
    await asA.mutation(api.events.rsvp, { eventId });
    const regs = await regsForEvent(t, eventId);

    expect(
      await asAdmin.mutation(api.admin.events.finalizeAttendance, { eventId }),
    ).toEqual({ ok: true });
    expect(
      await asAdmin.mutation(api.admin.events.finalizeAttendance, { eventId }),
    ).toEqual({ ok: true, already: true });
    expect(
      await asAdmin.mutation(api.admin.events.checkIn, { eventId,
        checkinCode: regs[0].checkin_code,
        outcome: "attended",
      }),
    ).toEqual({ ok: false, error: "invalid_state" });
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.state).toBe("attendance_finalized");
  });
});

describe("boundary validation follow-ups (Gate 4 round 2)", () => {
  it("upsert refuses a bad meeting link on the UPDATE path too", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const created = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs({ meeting_link: "https://meet.example.com/session" }),
    );
    expect(created.ok).toBe(true);
    const eventId = (created as { ok: true; eventId: Id<"events"> }).eventId;

    for (const bad of ["http://meet.example.com/x", "javascript:alert(1)"]) {
      expect(
        await asAdmin.mutation(
          api.admin.events.upsertEvent,
          upsertArgs({ eventId, meeting_link: bad }),
        ),
      ).toEqual({ ok: false, error: "validation" });
    }
    // The stored link is untouched by the refused updates.
    const row = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(row!.meeting_link).toBe("https://meet.example.com/session");

    const updated = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs({ eventId, meeting_link: "https://meet.example.com/moved" }),
    );
    expect(updated.ok).toBe(true);
  });

  it("upsert validates host_email and caps the free-text fields", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    for (const bad of [
      { host_email: "not-an-email" },
      { host_email: "host@" },
      { description: "x".repeat(5001) },
      { venue: "x".repeat(201) },
      { city: "x".repeat(101) },
      { host_name: "x".repeat(121) },
      { timezone: "x".repeat(65) },
    ]) {
      expect(
        await asAdmin.mutation(api.admin.events.upsertEvent, upsertArgs(bad)),
      ).toEqual({ ok: false, error: "validation" });
    }
    // A real address passes; an empty string clears the field, not an error.
    const ok = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs({ host_email: "host@example.com", host_name: "Captain Host" }),
    );
    expect(ok.ok).toBe(true);
    const cleared = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs({ host_email: "" }),
    );
    expect(cleared.ok).toBe(true);
  });

  it("host_email never reaches a member payload (schema promise: admin-only)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const created = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs({
        host_email: "host-private@example.com",
        host_name: "Captain Host",
        meeting_link: "https://meet.example.com/session",
      }),
    );
    const eventId = (created as { ok: true; eventId: Id<"events"> }).eventId;
    await asAdmin.mutation(api.admin.events.publishEvent, { eventId });

    const asMember = await signIn(t, "leak-check@example.com");
    await asMember.mutation(api.events.rsvp, { eventId });
    const list = await asMember.query(api.events.listEvents, {});
    const detail = await asMember.query(api.events.getEvent, { eventId });
    const mine = await asMember.query(api.events.myEvents, {});
    const pass = await asMember.query(api.events.getMyEventPass, { eventId });

    const everything = JSON.stringify({ list, detail, mine, pass });
    expect(everything).not.toContain("host-private@example.com");
    // The host is still shown by name - only the address is admin-only.
    expect(everything).toContain("Captain Host");
  });
});

describe("audience lane freezes once live (Gate 4 round 3)", () => {
  it("a published event's lane cannot change; a draft's still can", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);

    const created = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs({ audience_lane: "youth" as const }),
    );
    const eventId = (created as { ok: true; eventId: Id<"events"> }).eventId;

    // Draft: the lane is still a free choice.
    expect(
      (
        await asAdmin.mutation(
          api.admin.events.upsertEvent,
          upsertArgs({ eventId, audience_lane: "adult" as const }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await asAdmin.mutation(
          api.admin.events.upsertEvent,
          upsertArgs({ eventId, audience_lane: "youth" as const }),
        )
      ).ok,
    ).toBe(true);

    await asAdmin.mutation(api.admin.events.publishEvent, { eventId });
    const asMinor = await signIn(t, "younger@example.com", {
      member_lane: "minor",
      date_of_birth: "2011-05-01",
      guardian_consent_state: "confirmed",
    });
    expect((await asMinor.mutation(api.events.rsvp, { eventId })).ok).toBe(true);

    // Live with a minor booked: flipping to adult is refused, her booking
    // and the lane promise stand.
    expect(
      await asAdmin.mutation(
        api.admin.events.upsertEvent,
        upsertArgs({ eventId, audience_lane: "adult" as const }),
      ),
    ).toEqual({ ok: false, error: "lane_locked" });
    const row = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(row!.audience_lane).toBe("youth");

    // Same-lane edits still flow (fixing a typo on a live event is normal).
    expect(
      (
        await asAdmin.mutation(
          api.admin.events.upsertEvent,
          upsertArgs({
            eventId,
            audience_lane: "youth" as const,
            title: "Girls in Aviation Day (updated)",
          }),
        )
      ).ok,
    ).toBe(true);
  });
});

describe("waitlist promotion integrity (Gate 4 round 5)", () => {
  it("a live capacity edit below the registered count is refused; at or above passes", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const created = await asAdmin.mutation(
      api.admin.events.upsertEvent,
      upsertArgs({ capacity: 2 }),
    );
    const eventId = (created as { ok: true; eventId: Id<"events"> }).eventId;
    await asAdmin.mutation(api.admin.events.publishEvent, { eventId });
    const asA = await signIn(t, "cap-a@example.com");
    const asB = await signIn(t, "cap-b@example.com");
    await asA.mutation(api.events.rsvp, { eventId });
    await asB.mutation(api.events.rsvp, { eventId });

    expect(
      await asAdmin.mutation(
        api.admin.events.upsertEvent,
        upsertArgs({ eventId, capacity: 1 }),
      ),
    ).toEqual({ ok: false, error: "capacity_below_registered" });
    expect(
      (
        await asAdmin.mutation(
          api.admin.events.upsertEvent,
          upsertArgs({ eventId, capacity: 3 }),
        )
      ).ok,
    ).toBe(true);
  });

  it("promotion recounts the room: a shrunken capacity never overbooks", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, { capacity: 2 });
    const asA = await signIn(t, "ob-a@example.com");
    const asB = await signIn(t, "ob-b@example.com");
    const asC = await signIn(t, "ob-c@example.com");
    await asA.mutation(api.events.rsvp, { eventId }); // registered
    await asB.mutation(api.events.rsvp, { eventId }); // registered
    await asC.mutation(api.events.rsvp, { eventId }); // waitlisted
    // Simulate a stale shrink that slipped past the admin guard.
    await t.run(async (ctx) => {
      await ctx.db.patch(eventId, { capacity: 1 });
    });
    await asA.mutation(api.events.cancelMyRsvp, { eventId });
    // 1 registered remains against capacity 1: no seat is actually free,
    // so no one is promoted.
    const regs = await regsForEvent(t, eventId);
    expect(regs.filter((r) => r.state === "registered")).toHaveLength(1);
    expect(regs.filter((r) => r.state === "waitlisted")).toHaveLength(1);
  });

  it("an ineligible waitlisted member is skipped (kept in line, audited) and the next eligible one promotes", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, { capacity: 1 });
    const asA = await signIn(t, "el-a@example.com");
    const asB = await signIn(t, "el-b@example.com");
    const asC = await signIn(t, "el-c@example.com");
    await asA.mutation(api.events.rsvp, { eventId }); // registered
    await asB.mutation(api.events.rsvp, { eventId }); // waitlisted first
    await asC.mutation(api.events.rsvp, { eventId }); // waitlisted second
    // B is suspended before a seat frees.
    const memberB = await memberByEmail(t, "el-b@example.com");
    await t.run(async (ctx) => {
      await ctx.db.patch(memberB!._id, { lifecycle_state: "suspended" as const });
    });
    await asA.mutation(api.events.cancelMyRsvp, { eventId });

    const regs = await regsForEvent(t, eventId);
    const byMember = new Map(regs.map((r) => [r.member_id, r.state]));
    const memberC = await memberByEmail(t, "el-c@example.com");
    expect(byMember.get(memberB!._id)).toBe("waitlisted"); // kept in line
    expect(byMember.get(memberC!._id)).toBe("registered"); // promoted past her
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(
      audits.some((a) => a.action === "promoteFromWaitlist.skipped"),
    ).toBe(true);
  });

  it("during an open priority window a plain member is not promoted into the freed seat", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t, { capacity: 1 });
    const asA = await signIn(t, "pw-a@example.com");
    const asB = await signIn(t, "pw-b@example.com"); // plain member
    await asA.mutation(api.events.rsvp, { eventId }); // registered
    await asB.mutation(api.events.rsvp, { eventId }); // waitlisted (no window yet)
    // The window opens after she queued.
    await t.run(async (ctx) => {
      await ctx.db.patch(eventId, {
        priority_window_start: Date.now() - HOUR,
        priority_window_end: Date.now() + HOUR,
      });
    });
    await asA.mutation(api.events.cancelMyRsvp, { eventId });

    const regs = await regsForEvent(t, eventId);
    expect(regs.filter((r) => r.state === "registered")).toHaveLength(0);
    expect(regs.filter((r) => r.state === "waitlisted")).toHaveLength(1);
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(
      audits.some((a) => a.action === "promoteFromWaitlist.skipped"),
    ).toBe(true);

    // An Active Member in the same queue takes the seat instead.
    const asActive = await signIn(t, "pw-active@example.com", {
      standing: "active_member",
    });
    await asActive.mutation(api.events.rsvp, { eventId });
    const after = await regsForEvent(t, eventId);
    const activeMember = await memberByEmail(t, "pw-active@example.com");
    expect(
      after.find((r) => r.member_id === activeMember!._id)?.state,
    ).toBe("registered");
  });
});

describe("live events cannot move through a plain save (Gate 4 round 6)", () => {
  it("upsertEvent refuses time changes on a published event; postpone remains the notifying path", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const base = upsertArgs();
    const created = await asAdmin.mutation(api.admin.events.upsertEvent, base);
    const eventId = (created as { ok: true; eventId: Id<"events"> }).eventId;

    // Draft times are still free to change.
    expect(
      (
        await asAdmin.mutation(api.admin.events.upsertEvent, {
          ...base,
          eventId,
          starts_at: base.starts_at + HOUR,
          ends_at: base.ends_at + HOUR,
        })
      ).ok,
    ).toBe(true);

    await asAdmin.mutation(api.admin.events.publishEvent, { eventId });

    // Live: a shifted start is refused and nothing moves.
    expect(
      await asAdmin.mutation(api.admin.events.upsertEvent, {
        ...base,
        eventId,
        starts_at: base.starts_at + 2 * HOUR,
        ends_at: base.ends_at + 2 * HOUR,
      }),
    ).toEqual({ ok: false, error: "times_locked" });
    const row = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(row!.starts_at).toBe(base.starts_at + HOUR);

    // Same-times edits (a typo fix) still flow.
    expect(
      (
        await asAdmin.mutation(api.admin.events.upsertEvent, {
          ...base,
          eventId,
          title: "Skills Clinic: CVs That Land (updated)",
          starts_at: base.starts_at + HOUR,
          ends_at: base.ends_at + HOUR,
        })
      ).ok,
    ).toBe(true);
  });
});

describe("dossier audit actors never leak the member's email (Gate 4 round 6)", () => {
  it("her own actions read 'the member'; the raw address stays behind the audited reveal", async () => {
    const t = convexTest(schema, modules);
    const eventId = await insertEvent(t);
    const asMember = await signIn(t, "dossier-leak@example.com");
    // A real member action that writes her email as the audit actor.
    await asMember.mutation(api.events.rsvp, { eventId });

    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const member = await memberByEmail(t, "dossier-leak@example.com");
    const dossier = await asAdmin.query(api.admin.members.getMemberAdmin, {
      memberId: member!._id,
    });
    const raw = JSON.stringify(dossier);
    expect(raw).not.toContain("dossier-leak@example.com");
    expect(
      dossier!.recent_audit.some((r) => r.actor === "the member"),
    ).toBe(true);
    // System actors pass through untouched; the immutable audit row keeps
    // the raw actor for the record.
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(audits.some((a) => a.actor === "dossier-leak@example.com")).toBe(true);
  });
});
