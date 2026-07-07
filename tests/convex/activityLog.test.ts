import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { confirmEmailForMember } from "../../convex/lib/activation";
import schema from "../../convex/schema";

// ActivityLog integration tests (activity-log spec §D): the join funnel
// writes through the real mutations - once each, minors included - and the
// platform-health counters compute the PRD §13 kill criteria from aggregate
// counts only.

const modules = import.meta.glob("../../convex/**/*.*s");

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => ({ error: null }),
    };
  },
}));

const ADMIN_EMAIL = "issam@example.com";

beforeEach(() => {
  process.env.SUPER_ADMIN_EMAILS = ADMIN_EMAIL;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  process.env.AUTH_RESEND_KEY = "test-key";
  process.env.SITE_URL = "http://localhost:4321";
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Tester = TestConvex<typeof schema>;

const ADULT_DOB = "1990-01-15";
const MINOR_DOB = "2011-01-15";

const joinArgs = (email: string, dob: string) => ({
  name: "Amal Haddad",
  email,
  careerStageAnswer: "student",
  genderAnswer: "female" as const,
  dobAnswer: dob,
  consents: { terms: true, marketing: false, pipeline: false },
});

const rowsOfType = async (t: Tester, type: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query("activityLog").collect()).filter((a) => a.type === type),
  );

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

describe("join funnel (spec §B): the three steps write once, through the real mutations", () => {
  it("join_submitted then email_confirmed then onboarding_started, exactly once each", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(
      internal.members.createPendingMember,
      joinArgs("amal@example.com", ADULT_DOB),
    );
    expect(created.ok).toBe(true);
    expect(await rowsOfType(t, "join_submitted")).toHaveLength(1);

    // The magic-link redemption advances the lifecycle (lib/activation.ts,
    // exactly what auth.ts beforeSessionCreation calls).
    const next = await t.run(async (ctx) => {
      const member = await ctx.db
        .query("members")
        .withIndex("by_email", (q) => q.eq("email", "amal@example.com"))
        .unique();
      return confirmEmailForMember(ctx as unknown as MutationCtx, member!);
    });
    expect(next).toBe("active");
    expect(await rowsOfType(t, "email_confirmed")).toHaveLength(1);

    // A second confirm attempt is a no-op (not at email_unverified anymore).
    await t.run(async (ctx) => {
      const member = await ctx.db
        .query("members")
        .withIndex("by_email", (q) => q.eq("email", "amal@example.com"))
        .unique();
      return confirmEmailForMember(ctx as unknown as MutationCtx, member!);
    });
    expect(await rowsOfType(t, "email_confirmed")).toHaveLength(1);

    // First profile save = onboarding started; the second save is not a
    // second start.
    const userId = await t.run(async (ctx) => {
      const member = await ctx.db
        .query("members")
        .withIndex("by_email", (q) => q.eq("email", "amal@example.com"))
        .unique();
      const uid = await ctx.db.insert("users", { email: "amal@example.com" });
      await ctx.db.patch(member!._id, { userId: uid });
      return uid;
    });
    const asMember = t.withIdentity({ subject: `${userId}|testsession` });
    expect(
      (await asMember.mutation(api.members.updateProfile, { headline: "Pilot" }))
        .ok,
    ).toBe(true);
    expect(
      (
        await asMember.mutation(api.members.updateProfile, {
          headline: "Airline pilot",
        })
      ).ok,
    ).toBe(true);
    expect(await rowsOfType(t, "onboarding_started")).toHaveLength(1);
  });

  it("a minor's join and email confirmation are counted too (PRD §6.2, everyone)", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(internal.members.createPendingMember, {
      ...joinArgs("younger@example.com", MINOR_DOB),
      guardianName: "Huda Haddad",
      guardianEmail: "guardian@example.com",
    });
    expect(created.ok).toBe(true);
    expect(await rowsOfType(t, "join_submitted")).toHaveLength(1);

    const next = await t.run(async (ctx) => {
      const member = await ctx.db
        .query("members")
        .withIndex("by_email", (q) => q.eq("email", "younger@example.com"))
        .unique();
      return confirmEmailForMember(ctx as unknown as MutationCtx, member!);
    });
    expect(next).toBe("pending_guardian");
    expect(await rowsOfType(t, "email_confirmed")).toHaveLength(1);
  });
});

describe("engagement events (spec §B): deduped per referenced thing", () => {
  it("claim_completed on a finished claim", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("importedMembers", {
        legacy_row_id: "waime:101",
        legacy_row_hash: "testhash",
        normalized_email: "legacy@example.com",
        name: "Amal Haddad",
        dob_if_known: ADULT_DOB,
        legacy_membership_number: 101,
        claim_state: "unclaimed" as const,
        match_signals: { email: false, name: false, mobile: false, dob: false },
      });
    });
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "legacy@example.com" }),
    );
    const asClaimant = t.withIdentity({ subject: `${userId}|testsession` });
    const result = await asClaimant.mutation(api.members.matchClaim, {
      nameConfirmed: "Amal Haddad",
      dobAnswer: ADULT_DOB,
      genderAnswer: "female" as const,
      attestation: true,
      consents: { terms: true, marketing: false, pipeline: false },
    });
    expect(result).toEqual({ ok: true });
    expect(await rowsOfType(t, "claim_completed")).toHaveLength(1);
  });

  it("rsvp_confirmed once per event, however often she cancels and rebooks", async () => {
    const t = convexTest(schema, modules);
    const eventId = (await t.run(async (ctx) =>
      ctx.db.insert("events", eventRow() as never),
    )) as Id<"events">;
    const asMember = await signIn(t, "member@example.com");

    expect((await asMember.mutation(api.events.rsvp, { eventId })).ok).toBe(true);
    expect(
      (await asMember.mutation(api.events.cancelMyRsvp, { eventId })).ok,
    ).toBe(true);
    expect((await asMember.mutation(api.events.rsvp, { eventId })).ok).toBe(true);
    expect(await rowsOfType(t, "rsvp_confirmed")).toHaveLength(1);
  });

  it("event_checked_in once per event, and only for attended - never no-show", async () => {
    const t = convexTest(schema, modules);
    const eventId = (await t.run(async (ctx) =>
      ctx.db.insert("events", eventRow() as never),
    )) as Id<"events">;
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const asMember = await signIn(t, "attendee@example.com");
    await asMember.mutation(api.events.rsvp, { eventId });
    const regId = await t.run(async (ctx) => {
      const regs = await ctx.db.query("eventRegistrations").collect();
      return regs[0]._id;
    });

    await asAdmin.mutation(api.admin.events.checkIn, {
      eventId,
      registrationId: regId,
      outcome: "no_show",
    });
    expect(await rowsOfType(t, "event_checked_in")).toHaveLength(0);

    await asAdmin.mutation(api.admin.events.checkIn, {
      eventId,
      registrationId: regId,
      outcome: "attended",
    });
    // The correction dance never double-counts.
    await asAdmin.mutation(api.admin.events.checkIn, {
      eventId,
      registrationId: regId,
      outcome: "no_show",
    });
    await asAdmin.mutation(api.admin.events.checkIn, {
      eventId,
      registrationId: regId,
      outcome: "attended",
    });
    expect(await rowsOfType(t, "event_checked_in")).toHaveLength(1);
  });
});

describe("platform health (spec §C): super-admin only, honest pre-launch nulls", () => {
  it("denies a non-admin with the neutral error", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, "member@example.com");
    await expect(
      asMember.query(api.admin.overview.getPlatformHealth, {}),
    ).rejects.toThrow(/not_authorized/);
  });

  it("computes the funnel, claim rate, partners and monthly-active from seeded data", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("seeded@example.com") as never),
    );
    await t.run(async (ctx) => {
      const now = Date.now();
      // Funnel: 3 joined, 2 confirmed, 1 onboarded.
      await ctx.db.insert("activityLog", { type: "join_submitted", member_id: memberId, at: now - 40 * DAY });
      await ctx.db.insert("activityLog", { type: "join_submitted", at: now - 3 * DAY });
      await ctx.db.insert("activityLog", { type: "join_submitted", at: now - 2 * DAY });
      await ctx.db.insert("activityLog", { type: "email_confirmed", member_id: memberId, at: now - 40 * DAY });
      await ctx.db.insert("activityLog", { type: "email_confirmed", at: now - 2 * DAY });
      await ctx.db.insert("activityLog", { type: "onboarding_started", member_id: memberId, at: now - 39 * DAY });
      // Monthly active: only rows inside 30 days with a member count, and
      // the same member twice is ONE.
      await ctx.db.insert("activityLog", { type: "rsvp_confirmed", member_id: memberId, at: now - 5 * DAY });
      await ctx.db.insert("activityLog", { type: "application_submitted", member_id: memberId, at: now - 4 * DAY });
      // Claim rate: 4 registered, 1 claimed = 25.0 (not missed at <25 rule).
      for (const [i, state] of (["claimed", "unclaimed", "unclaimed", "unclaimed"] as const).entries()) {
        await ctx.db.insert("importedMembers", {
          legacy_row_id: `waime:${200 + i}`,
          legacy_row_hash: `h${i}`,
          normalized_email: `legacy${i}@example.com`,
          name: `Legacy ${i}`,
          claim_state: state,
          match_signals: { email: false, name: false, mobile: false, dob: false },
        });
      }
      // One active partner: criterion 3 not missed.
      await ctx.db.insert("partners", {
        name: "Pier Seven Aviation",
        tier: "partner",
        status: "active",
        term_months: 12,
        deliverables: [],
        show_publicly: false,
        seal: "none",
        created_at: now,
      } as never);
      // Review date set.
      await ctx.db.insert("counters", { name: "platform_review_at", value: now + 90 * DAY });
    });

    const health = await asAdmin.query(api.admin.overview.getPlatformHealth, {});
    expect(health.funnel).toEqual({
      join_submitted: 3,
      email_confirmed: 2,
      onboarding_started: 1,
    });
    expect(health.kill_criteria.claim_rate.claimed).toBe(1);
    expect(health.kill_criteria.claim_rate.registered).toBe(4);
    expect(health.kill_criteria.claim_rate.pct).toBe(25);
    expect(health.kill_criteria.claim_rate.missed).toBe(false);
    expect(health.kill_criteria.corporate_partners).toEqual({
      active_count: 1,
      missed: false,
    });
    expect(health.kill_criteria.monthly_active.active_30d).toBe(1);
    expect(health.kill_criteria.monthly_active.claimed).toBe(1);
    expect(health.kill_criteria.monthly_active.pct).toBe(100);
    expect(health.kill_criteria.monthly_active.missed).toBe(false);
    // No events seeded: all six checked months are missed.
    expect(health.kill_criteria.event_floor).toEqual({
      months_checked: 6,
      months_missed: 6,
      missed: true,
    });
    expect(health.review_at).not.toBeNull();
    // Aggregates only: no emails, no names of members.
    const raw = JSON.stringify(health);
    expect(raw).not.toContain("@example.com");
    expect(raw).not.toContain("Test Member");
  });

  it("reports honest nulls before the import and the launch date exist", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const health = await asAdmin.query(api.admin.overview.getPlatformHealth, {});
    expect(health.kill_criteria.claim_rate.pct).toBeNull();
    expect(health.kill_criteria.claim_rate.missed).toBeNull();
    expect(health.kill_criteria.monthly_active.pct).toBeNull();
    expect(health.kill_criteria.monthly_active.missed).toBeNull();
    expect(health.review_at).toBeNull();
  });
});
