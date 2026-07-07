import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// panel-experience Gate 1 tests for the member-facing portal backend
// (spec C10 / D11 / E12): notifications own-rows-only, the directory's
// canonical listing rule enforced at query time, getMyMembership's truthful
// shape, and the standing Rung-2 hook on the REAL updateProfile mutation.

const modules = import.meta.glob("../../convex/**/*.*s");

const sentEmails: Array<{ to: string[]; text: string }> = [];
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (args: { to: string[]; text: string }) => {
        sentEmails.push(args);
        return { error: null };
      },
    };
  },
}));

beforeEach(() => {
  sentEmails.length = 0;
  process.env.SUPER_ADMIN_EMAILS = "issam@example.com";
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  process.env.AUTH_RESEND_KEY = "test-key";
  process.env.SITE_URL = "http://localhost:4321";
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

// Sign in as a member AND keep her row id, for fixtures that hang rows off it.
const signInMember = async (
  t: ReturnType<typeof convexTest>,
  email: string,
  extra: Record<string, unknown> = {},
) => {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  const memberId = await t.run(async (ctx) =>
    ctx.db.insert("members", { ...memberRow(email, extra), userId }),
  );
  return {
    as: t.withIdentity({ subject: `${userId}|testsession` }),
    memberId,
  };
};

const insertMember = async (
  t: ReturnType<typeof convexTest>,
  email: string,
  extra: Record<string, unknown> = {},
) => t.run(async (ctx) => ctx.db.insert("members", memberRow(email, extra)));

// A member row that satisfies EVERY canonical directory condition; tests
// flip one condition at a time off this baseline.
const listedExtra = {
  directory_visible: true,
  standing: "active_member" as const,
  headline: "Airline captain",
  country_of_residence: "United Arab Emirates",
  sectors: ["Airline"],
};

const insertEvent = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    ctx.db.insert("events", {
      title: "Story Session",
      category: "story_session" as const,
      short_description: "A member story session.",
      starts_at: Date.now() - 7 * 24 * 60 * 60 * 1000,
      ends_at: Date.now() - 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
      timezone: "GST",
      format: "online" as const,
      audience_lane: "adult" as const,
      state: "attendance_finalized" as const,
      created_at: Date.now(),
    }),
  );

const insertAttendedRegistration = async (
  t: ReturnType<typeof convexTest>,
  eventId: Id<"events">,
  memberId: Id<"members">,
) =>
  t.run(async (ctx) =>
    ctx.db.insert("eventRegistrations", {
      event_id: eventId,
      member_id: memberId,
      state: "attended" as const,
      checkin_code: `code-${memberId}`,
      created_at: Date.now(),
    }),
  );

const insertApplication = async (
  t: ReturnType<typeof convexTest>,
  memberId: Id<"members">,
  state: "received" | "withdrawn",
) =>
  t.run(async (ctx) => {
    const opportunityId = await ctx.db.insert("opportunities", {
      title: "Type Rating Scholarship",
      type: "competitive" as const,
      description: "A scholarship.",
      audience: "women_only" as const,
      deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
      state: "open" as const,
      created_at: Date.now(),
    });
    return ctx.db.insert("opportunityApplications", {
      opportunity_id: opportunityId,
      member_id: memberId,
      state,
      created_at: Date.now(),
    });
  });

const insertNotification = async (
  t: ReturnType<typeof convexTest>,
  memberId: Id<"members">,
  title: string,
  createdAt: number,
  readAt?: number,
) =>
  t.run(async (ctx) =>
    ctx.db.insert("notifications", {
      member_id: memberId,
      type: "event_rsvp" as const,
      title,
      body: "You have a seat.",
      channel: "in_app" as const,
      read_at: readAt,
      created_at: createdAt,
    }),
  );

describe("directory: the canonical listing rule (spec D11)", () => {
  it("each condition independently flips a member out of the listing", async () => {
    const t = convexTest(schema, modules);
    const { as: viewer } = await signInMember(t, "viewer@example.com");
    await insertMember(t, "listed@example.com", {
      ...listedExtra,
      name: "Amira Al Farsi",
    });
    await insertMember(t, "ally@example.com", {
      ...listedExtra,
      name: "Omar Haddad",
      member_lane: "ally" as const,
      gender: "male" as const,
    });
    await insertMember(t, "toggle-off@example.com", {
      ...listedExtra,
      name: "Toggle Off",
      directory_visible: false,
    });
    await insertMember(t, "plain-member@example.com", {
      ...listedExtra,
      name: "Plain Member",
      standing: undefined,
    });
    await insertMember(t, "minor@example.com", {
      ...listedExtra,
      name: "Minor Lane",
      member_lane: "minor" as const,
    });
    await insertMember(t, "dormant@example.com", {
      ...listedExtra,
      name: "Dormant Member",
      lifecycle_state: "dormant" as const,
    });

    const res = await viewer.query(api.directory.listDirectory, {});
    expect(res).not.toBeNull();
    expect(res?.locked).toBe(false);
    const names = (res?.rows ?? []).map((r) => r.name).sort();
    // Present: the standard baseline AND the ally (both active_member,
    // toggle on, active). Absent: toggle off, plain standing, minor lane,
    // dormant lifecycle - each fails exactly one canonical condition.
    expect(names).toEqual(["Amira Al Farsi", "Omar Haddad"]);
  });

  it("a minor viewer gets locked:true and zero rows; so does restricted_unknown", async () => {
    const t = convexTest(schema, modules);
    await insertMember(t, "listed@example.com", listedExtra);
    const { as: minorViewer } = await signInMember(t, "kid@example.com", {
      member_lane: "minor" as const,
      date_of_birth: "2012-01-01",
      guardian_consent_state: "confirmed" as const,
    });
    expect(await minorViewer.query(api.directory.listDirectory, {})).toEqual({
      rows: [],
      locked: true,
    });
    const { as: unknownViewer } = await signInMember(
      t,
      "unknown@example.com",
      { member_lane: "restricted_unknown" as const, date_of_birth: undefined },
    );
    expect(await unknownViewer.query(api.directory.listDirectory, {})).toEqual({
      rows: [],
      locked: true,
    });
  });

  it("rows carry directory-tier fields only: never email, gender, date_of_birth, mobile, bio", async () => {
    const t = convexTest(schema, modules);
    const { as: viewer } = await signInMember(t, "viewer@example.com");
    await insertMember(t, "private@example.com", {
      ...listedExtra,
      name: "Private Fields",
      mobile: "+971501234567",
      // Gate 4 (2026-07-07): bio never ships in a directory row - a migrated
      // member's legacy_bio is years-old text she has not reviewed since.
      bio: "Wrote this in 2019 for a different site entirely.",
    });
    const res = await viewer.query(api.directory.listDirectory, {});
    expect(res?.rows).toHaveLength(1);
    for (const row of res?.rows ?? []) {
      const keys = Object.keys(row);
      expect(keys).not.toContain("email");
      expect(keys).not.toContain("gender");
      expect(keys).not.toContain("date_of_birth");
      expect(keys).not.toContain("mobile");
      expect(keys).not.toContain("bio");
      expect(keys).not.toContain("legacy_bio");
    }
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("+971501234567");
    expect(serialized).not.toContain("1985-03-10");
    expect(serialized).not.toContain("Wrote this in 2019");
  });

  it("search matches name or headline; filters are exact", async () => {
    const t = convexTest(schema, modules);
    const { as: viewer } = await signInMember(t, "viewer@example.com");
    await insertMember(t, "a@example.com", {
      ...listedExtra,
      name: "Amira Al Farsi",
      headline: "Airline captain",
      country_of_residence: "United Arab Emirates",
      sectors: ["Airline"],
    });
    await insertMember(t, "b@example.com", {
      ...listedExtra,
      name: "Layla Haddad",
      headline: "ATC supervisor",
      country_of_residence: "Jordan",
      career_stage_answer: "Studying / cadet",
      sectors: ["ANSP"],
    });

    const bySearch = await viewer.query(api.directory.listDirectory, {
      search: "captain",
    });
    expect(bySearch?.rows.map((r) => r.name)).toEqual(["Amira Al Farsi"]);

    const byCountry = await viewer.query(api.directory.listDirectory, {
      country: "Jordan",
    });
    expect(byCountry?.rows.map((r) => r.name)).toEqual(["Layla Haddad"]);

    const byStage = await viewer.query(api.directory.listDirectory, {
      careerStage: "Studying / cadet",
    });
    expect(byStage?.rows.map((r) => r.name)).toEqual(["Layla Haddad"]);

    const bySector = await viewer.query(api.directory.listDirectory, {
      sector: "Airline",
    });
    expect(bySector?.rows.map((r) => r.name)).toEqual(["Amira Al Farsi"]);
  });

  it("a signed-out caller gets null, never rows", async () => {
    const t = convexTest(schema, modules);
    await insertMember(t, "listed@example.com", listedExtra);
    expect(await t.query(api.directory.listDirectory, {})).toBeNull();
  });
});

describe("notifications: own rows only (spec E12)", () => {
  it("myNotifications lists only the caller's rows, newest first; unreadCount is truthful", async () => {
    const t = convexTest(schema, modules);
    const { as: asA, memberId: aId } = await signInMember(t, "a@example.com");
    const { as: asB, memberId: bId } = await signInMember(t, "b@example.com");
    const base = Date.now();
    await insertNotification(t, aId, "Oldest for A", base - 3000, base);
    await insertNotification(t, aId, "Middle for A", base - 2000);
    await insertNotification(t, aId, "Newest for A", base - 1000);
    await insertNotification(t, bId, "Only for B", base - 500);

    const aRows = await asA.query(api.notifications.myNotifications, {});
    expect(aRows?.map((r) => r.title)).toEqual([
      "Newest for A",
      "Middle for A",
      "Oldest for A",
    ]);
    expect(await asA.query(api.notifications.unreadCount, {})).toBe(2);

    const bRows = await asB.query(api.notifications.myNotifications, {});
    expect(bRows?.map((r) => r.title)).toEqual(["Only for B"]);
    expect(await asB.query(api.notifications.unreadCount, {})).toBe(1);

    // Signed out: null list, zero count, nothing leaked.
    expect(await t.query(api.notifications.myNotifications, {})).toBeNull();
    expect(await t.query(api.notifications.unreadCount, {})).toBe(0);
  });

  it("markRead refuses another member's row with the same not_found as a missing row", async () => {
    const t = convexTest(schema, modules);
    const { as: asA, memberId: aId } = await signInMember(t, "a@example.com");
    const { as: asB } = await signInMember(t, "b@example.com");
    const aNotification = await insertNotification(
      t,
      aId,
      "A's row",
      Date.now(),
    );

    // B probing A's row: identical envelope to a nonexistent row, so
    // existence of other members' rows can never be inferred.
    expect(
      await asB.mutation(api.notifications.markRead, {
        notificationId: aNotification,
      }),
    ).toEqual({ ok: false, error: "not_found" });
    // A's row stays unread.
    expect(await asA.query(api.notifications.unreadCount, {})).toBe(1);

    // The owner can mark it; a second call is harmless.
    expect(
      await asA.mutation(api.notifications.markRead, {
        notificationId: aNotification,
      }),
    ).toEqual({ ok: true });
    expect(
      await asA.mutation(api.notifications.markRead, {
        notificationId: aNotification,
      }),
    ).toEqual({ ok: true });
    expect(await asA.query(api.notifications.unreadCount, {})).toBe(0);
  });

  it("markAllRead clears the caller's unread rows and nobody else's", async () => {
    const t = convexTest(schema, modules);
    const { as: asA, memberId: aId } = await signInMember(t, "a@example.com");
    const { as: asB, memberId: bId } = await signInMember(t, "b@example.com");
    await insertNotification(t, aId, "A one", Date.now() - 2000);
    await insertNotification(t, aId, "A two", Date.now() - 1000);
    await insertNotification(t, bId, "B one", Date.now() - 1500);

    expect(await asA.mutation(api.notifications.markAllRead, {})).toEqual({
      ok: true,
    });
    expect(await asA.query(api.notifications.unreadCount, {})).toBe(0);
    expect(await asB.query(api.notifications.unreadCount, {})).toBe(1);
  });

  it("pages hold 25 rows, newest first", async () => {
    const t = convexTest(schema, modules);
    const { as: asC, memberId: cId } = await signInMember(t, "c@example.com");
    const base = Date.now();
    for (let i = 0; i < 27; i++) {
      await insertNotification(t, cId, `n${i}`, base + i);
    }
    const page0 = await asC.query(api.notifications.myNotifications, {});
    expect(page0).toHaveLength(25);
    expect(page0?.[0]?.title).toBe("n26");
    expect(page0?.[24]?.title).toBe("n2");
    const page1 = await asC.query(api.notifications.myNotifications, {
      page: 1,
    });
    expect(page1?.map((r) => r.title)).toEqual(["n1", "n0"]);
  });
});

describe("getMyMembership (spec C10)", () => {
  it("returns the truthful shape for a fresh member: plain standing, no certificate, honest progress", async () => {
    const t = convexTest(schema, modules);
    const createdAt = new Date("2026-03-05T09:00:00Z").getTime();
    const { as } = await signInMember(t, "fresh@example.com", {
      created_at: createdAt,
    });
    const res = await as.query(api.membership.getMyMembership, {});
    expect(res).toEqual({
      lifecycle_state: "active",
      standing: "member",
      member_since: "2026-03-05",
      certificate: null,
      directory_visible: false,
      pipeline_state: "off",
      standing_history: [],
      qualifying_progress: {
        // Fixture has name + career stage but no photo, function area or
        // country: NOT complete, and the page must say so.
        profile_complete: false,
        has_attended: false,
        has_applied: false,
      },
    });
  });

  it("member_since prefers original_joined_at for migrated members", async () => {
    const t = convexTest(schema, modules);
    const { as } = await signInMember(t, "migrated@example.com", {
      source: "migrated" as const,
      original_joined_at: "2016-04-12",
    });
    const res = await as.query(api.membership.getMyMembership, {});
    expect(res?.member_since).toBe("2016-04-12");
  });

  it("surfaces the membership certificate number and status once issued", async () => {
    const t = convexTest(schema, modules);
    const { as, memberId } = await signInMember(t, "certed@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("certificates", {
        member_id: memberId,
        type: "membership" as const,
        verify_token: "tok-1",
        membership_number: 1042,
        recipient_name: "Test Member",
        issued_at: Date.now(),
        issued_date_label: "5 March 2026",
        is_founding: false,
        status: "valid" as const,
        template_version: "membership-2026-06",
        idempotency_key: "cert-1042",
      });
    });
    const res = await as.query(api.membership.getMyMembership, {});
    expect(res?.certificate).toEqual({ number: 1042, status: "valid" });
  });

  it("qualifying_progress tracks real attendance and non-withdrawn applications, plus standing history rows", async () => {
    const t = convexTest(schema, modules);
    const { as, memberId } = await signInMember(t, "active@example.com");

    // A withdrawn application does NOT count as a qualifying action.
    await insertApplication(t, memberId, "withdrawn");
    let res = await as.query(api.membership.getMyMembership, {});
    expect(res?.qualifying_progress.has_applied).toBe(false);
    expect(res?.qualifying_progress.has_attended).toBe(false);

    const eventId = await insertEvent(t);
    await insertAttendedRegistration(t, eventId, memberId);
    await insertApplication(t, memberId, "received");
    await t.run(async (ctx) => {
      await ctx.db.insert("standingHistory", {
        member_id: memberId,
        from_standing: "member",
        to_standing: "active_member",
        reason: "profile complete + attended an event",
        timestamp: Date.now(),
      });
    });

    res = await as.query(api.membership.getMyMembership, {});
    expect(res?.qualifying_progress.has_attended).toBe(true);
    expect(res?.qualifying_progress.has_applied).toBe(true);
    expect(res?.standing_history).toEqual([
      {
        from_standing: "member",
        to_standing: "active_member",
        reason: "profile complete + attended an event",
        timestamp: expect.any(Number),
      },
    ]);
  });

  it("returns null when signed out", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.membership.getMyMembership, {})).toBeNull();
  });
});

describe("standing Rung-2 hook on the real updateProfile mutation", () => {
  it("completing the profile promotes a member who already attended an event", async () => {
    const t = convexTest(schema, modules);
    // Photo is seeded on the row (a real stored blob id); the mutation call
    // fills the remaining completeness fields, driving the REAL boundary.
    const photoId = await t.run(async (ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      ),
    );
    const { as, memberId } = await signInMember(t, "she@example.com", {
      photo_storage_id: photoId,
    });
    const eventId = await insertEvent(t);
    await insertAttendedRegistration(t, eventId, memberId);

    const res = await as.mutation(api.members.updateProfile, {
      function_area: "Flight Operations",
      role: "Pilot (Captain)",
      country_of_residence: "United Arab Emirates",
    });
    expect(res).toEqual({ ok: true, profile_complete: true });

    const member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.standing).toBe("active_member");

    await t.run(async (ctx) => {
      const history = await ctx.db
        .query("standingHistory")
        .withIndex("by_member_time", (q) => q.eq("member_id", memberId))
        .collect();
      expect(history).toHaveLength(1);
      expect(history[0].from_standing).toBe("member");
      expect(history[0].to_standing).toBe("active_member");

      const notifications = await ctx.db
        .query("notifications")
        .withIndex("by_member_time", (q) => q.eq("member_id", memberId))
        .collect();
      expect(
        notifications.some((n) => n.type === "standing_change"),
      ).toBe(true);

      const audits = await ctx.db.query("auditLog").collect();
      expect(
        audits.some(
          (a) =>
            a.action === "standing.promote_active" && a.target_id === memberId,
        ),
      ).toBe(true);
    });
  });

  it("completing the profile with NO qualifying action does not promote", async () => {
    const t = convexTest(schema, modules);
    const photoId = await t.run(async (ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      ),
    );
    const { as, memberId } = await signInMember(t, "quiet@example.com", {
      photo_storage_id: photoId,
    });

    const res = await as.mutation(api.members.updateProfile, {
      function_area: "Flight Operations",
      role: "Pilot (Captain)",
      country_of_residence: "United Arab Emirates",
    });
    expect(res).toEqual({ ok: true, profile_complete: true });

    const member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.standing ?? "member").toBe("member");
    const history = await t.run(async (ctx) =>
      ctx.db
        .query("standingHistory")
        .withIndex("by_member_time", (q) => q.eq("member_id", memberId))
        .collect(),
    );
    expect(history).toHaveLength(0);
  });
});

describe("profile free-text is bounded at the write boundary (Gate 4 round 12)", () => {
  it("an over-long bio, headline, or spammed array is refused; a normal profile saves", async () => {
    const t = convexTest(schema, modules);
    const { as } = await signInMember(t, "bounds@example.com");
    // Over-long bio.
    expect(
      (await as.mutation(api.members.updateProfile, { bio: "x".repeat(1201) })).error,
    ).toBe("invalid:bio");
    // Over-long headline.
    expect(
      (await as.mutation(api.members.updateProfile, { headline: "y".repeat(141) })).error,
    ).toBe("invalid:headline");
    // Spammed array.
    expect(
      (
        await as.mutation(api.members.updateProfile, {
          sectors: Array.from({ length: 21 }, (_, i) => `Sector ${i}`),
        })
      ).error,
    ).toBe("invalid:sectors");
    // A normal profile within bounds saves.
    expect(
      (
        await as.mutation(api.members.updateProfile, {
          bio: "A short, honest bio.",
          headline: "First Officer, A320",
        })
      ).ok,
    ).toBe(true);
  });
});
