import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Overview query tests (panel-design spec criterion 9 + 17): the console's
// PII-free counts. Deny-by-default like every admin query, counts that match
// the queues' own definitions, and the vault integrity rule proven: registered
// (imported list) and active are separate numbers, never conflated.

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

const memberRow = (
  email: string,
  extra: Record<string, unknown> = {},
) => ({
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

const importedRow = (
  rid: string,
  email: string,
  claimState:
    | "unclaimed"
    | "claimed"
    | "conflict"
    | "suppressed_minor"
    | "archived_conflict",
) => ({
  legacy_row_id: `waime:${rid}`,
  legacy_row_hash: rid,
  normalized_email: email,
  name: `Legacy ${rid}`,
  claim_state: claimState,
  match_signals: { email: true, name: false, mobile: false, dob: false },
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

describe("admin overview: deny-by-default", () => {
  it("a non-admin member gets the neutral refusal", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    await expect(
      asMember.query(api.admin.overview.getAdminOverview, {}),
    ).rejects.toThrow(/not_authorized/);
  });

  it("an unauthenticated caller is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.admin.overview.getAdminOverview, {}),
    ).rejects.toThrow(/not_authorized/);
  });
});

describe("admin overview: counts", () => {
  it("counts members, legacy rows and every queue against seeded fixtures", async () => {
    const t = convexTest(schema, modules);
    // signIn creates the admin's own ACTIVE member row.
    const asAdmin = await signIn(t, ADMIN_EMAIL);

    await t.run(async (ctx) => {
      // Members: one more active, one waiting on a guardian, one archived and
      // one dormant. Archived counts in NEITHER active nor waiting; dormant is
      // not "waiting on a step" either (the label names guardian / review /
      // email confirmation only).
      const activeId = await ctx.db.insert(
        "members",
        memberRow("active@example.com"),
      );
      const pendingId = await ctx.db.insert(
        "members",
        memberRow("waiting@example.com", {
          lifecycle_state: "pending_guardian" as const,
          member_lane: "minor" as const,
          guardian_consent_state: "pending" as const,
          date_of_birth: "2012-03-10",
        }),
      );
      await ctx.db.insert(
        "members",
        memberRow("gone@example.com", { lifecycle_state: "archived" as const }),
      );
      await ctx.db.insert(
        "members",
        memberRow("resting@example.com", {
          lifecycle_state: "dormant" as const,
        }),
      );

      // Legacy list: one claimed, one unclaimed, one conflict, one held minor,
      // one archived trail row. The badge counts OPEN work only: conflict +
      // suppressed_minor; archived_conflict stays in the queue view as the
      // read-only trail but never inflates "waiting".
      await ctx.db.insert(
        "importedMembers",
        importedRow("c1", "claimed@example.com", "claimed"),
      );
      await ctx.db.insert(
        "importedMembers",
        importedRow("u1", "unclaimed@example.com", "unclaimed"),
      );
      await ctx.db.insert("importedMembers", {
        ...importedRow("k1", "conflict@example.com", "conflict"),
        conflict_reason: "duplicate_email",
      });
      await ctx.db.insert(
        "importedMembers",
        importedRow("s1", "minor@example.com", "suppressed_minor"),
      );
      await ctx.db.insert(
        "importedMembers",
        importedRow("a1", "archived@example.com", "archived_conflict"),
      );

      // One open row per remaining queue...
      await ctx.db.insert("pipelineEligibilityReviews", {
        member_id: activeId,
        state: "pending",
        timestamp: Date.now(),
      });
      await ctx.db.insert("guardianConsents", {
        member_id: pendingId,
        guardian_name: "Guardian Name",
        guardian_email: "guardian@example.com",
        confirmation_state: "pending",
        confirmation_token_hash: "hash",
        timestamp: Date.now(),
      });
      await ctx.db.insert("dataRequests", {
        subject_email: "subject@example.com",
        kind: "export",
        state: "submitted",
        created_at: Date.now(),
      });

      // ...plus one row each whose member has been DELETED: the queues skip
      // them (member-existence rule) and the counts must match the queues.
      const ghostId = await ctx.db.insert(
        "members",
        memberRow("ghost@example.com"),
      );
      await ctx.db.insert("pipelineEligibilityReviews", {
        member_id: ghostId,
        state: "pending",
        timestamp: Date.now(),
      });
      await ctx.db.insert("guardianConsents", {
        member_id: ghostId,
        guardian_name: "Ghost Guardian",
        guardian_email: "ghost-guardian@example.com",
        confirmation_state: "pending",
        confirmation_token_hash: "ghost-hash",
        timestamp: Date.now(),
      });
      await ctx.db.delete(ghostId);
    });

    const counts = await asAdmin.query(api.admin.overview.getAdminOverview, {});
    expect(counts).toEqual({
      members_active: 2,
      members_waiting: 1,
      legacy_registered: 5,
      legacy_claimed: 1,
      queue_conflicts: 2,
      queue_pipeline: 1,
      queue_guardians: 1,
      queue_data_requests: 1,
    });
  });

  it("keeps registered and active distinct: a claim never re-counts the list", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const rowId = await t.run(async (ctx) => {
      const id = await ctx.db.insert(
        "importedMembers",
        importedRow("r1", "legacy1@example.com", "unclaimed"),
      );
      await ctx.db.insert(
        "importedMembers",
        importedRow("r2", "legacy2@example.com", "unclaimed"),
      );
      return id;
    });

    // Before any claim: 2 registered, 0 claimed, 1 active (the admin). The
    // imported list is "registered", never implied active.
    const before = await asAdmin.query(api.admin.overview.getAdminOverview, {});
    expect(before.legacy_registered).toBe(2);
    expect(before.legacy_claimed).toBe(0);
    expect(before.members_active).toBe(1);

    // One legacy member claims her row and becomes an active member.
    await t.run(async (ctx) => {
      const memberId = await ctx.db.insert(
        "members",
        memberRow("legacy1@example.com", { source: "migrated" as const }),
      );
      await ctx.db.patch(rowId, {
        claim_state: "claimed" as const,
        linked_member_id: memberId,
      });
    });

    // registered stays 2 (the list is what it is); claimed and active each
    // moved by one, independently of registered. Distinct numbers, never
    // conflated: the claim changed members_active and legacy_claimed but did
    // NOT change legacy_registered.
    const after = await asAdmin.query(api.admin.overview.getAdminOverview, {});
    expect(after.legacy_registered).toBe(before.legacy_registered);
    expect(after.legacy_claimed).toBe(before.legacy_claimed + 1);
    expect(after.members_active).toBe(before.members_active + 1);
  });
});

describe("report aggregates (spec H18): sanctioned counts over active members only", () => {
  it("denies a non-admin with the neutral error", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    await expect(
      asMember.query(api.admin.overview.getReportAggregates, {}),
    ).rejects.toThrow("not_authorized");
  });

  it("aggregates active members only and returns counts, never names or contact data", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "members",
        memberRow("a@example.com", {
          country_of_residence: "United Arab Emirates",
          pipeline_state: "on",
        }),
      );
      await ctx.db.insert(
        "members",
        memberRow("b@example.com", { country_of_residence: "United Arab Emirates" }),
      );
      await ctx.db.insert(
        "members",
        memberRow("c@example.com", {
          country_of_residence: "Saudi Arabia",
          career_stage_answer: "Studying aviation",
        }),
      );
      // Dormant: in no aggregate, including her pipeline flag and country.
      await ctx.db.insert(
        "members",
        memberRow("d@example.com", {
          country_of_residence: "United Arab Emirates",
          lifecycle_state: "dormant" as const,
          pipeline_state: "on",
        }),
      );
    });
    const asAdmin = await signIn(t, ADMIN_EMAIL);

    const report = await asAdmin.query(api.admin.overview.getReportAggregates, {});
    expect(report.pipeline_on).toBe(1);
    expect(report.by_country).toEqual([
      { label: "United Arab Emirates", count: 2 },
      { label: "Saudi Arabia", count: 1 },
    ]);
    // The signed-in admin is herself an active member (career stage
    // "Working in aviation", no country), so that bucket counts a, b + her.
    expect(report.by_career_stage).toEqual([
      { label: "Working in aviation", count: 3 },
      { label: "Studying aviation", count: 1 },
    ]);
    // Aggregate discipline: the payload carries no emails and no names.
    const raw = JSON.stringify(report);
    expect(raw).not.toContain("@example.com");
    expect(raw).not.toContain("Test Member");
  });
});

describe("report stats (spec H18, Gate 4 round 3): the reports route gets counts only", () => {
  it("denies a non-admin with the neutral error", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    await expect(
      asMember.query(api.admin.overview.getReportStats, {}),
    ).rejects.toThrow("not_authorized");
  });

  it("returns aggregate counts with no rows, names or emails", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const now = Date.now();
    await t.run(async (ctx) => {
      const memberId = await ctx.db.insert(
        "members",
        memberRow("counted@example.com") as never,
      );
      const eventId = await ctx.db.insert("events", {
        title: "Delivered Session",
        category: "workshop",
        short_description: "Ran and finalized.",
        starts_at: now - 3 * 24 * 60 * 60 * 1000,
        ends_at: now - 3 * 24 * 60 * 60 * 1000 + 3600000,
        timezone: "GST",
        format: "online",
        audience_lane: "adult",
        state: "attendance_finalized",
        created_at: now - 10 * 24 * 60 * 60 * 1000,
        published_at: now - 9 * 24 * 60 * 60 * 1000,
      } as never);
      await ctx.db.insert("eventRegistrations", {
        event_id: eventId,
        member_id: memberId,
        state: "attended",
        checkin_code: "code-stats-test",
        created_at: now - 5 * 24 * 60 * 60 * 1000,
      } as never);
      const oppId = await ctx.db.insert("opportunities", {
        title: "Posted Listing",
        type: "competitive",
        description: "Live listing.",
        audience: "open",
        deadline: now + 7 * 24 * 60 * 60 * 1000,
        state: "open",
        created_at: now,
        published_at: now,
      } as never);
      await ctx.db.insert("opportunities", {
        title: "Draft Listing",
        type: "competitive",
        description: "Not posted.",
        audience: "open",
        deadline: now + 7 * 24 * 60 * 60 * 1000,
        state: "draft",
        created_at: now,
      } as never);
      await ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: memberId,
        statement: "Applying.",
        state: "won",
        created_at: now,
      } as never);
      await ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: memberId,
        statement: "Withdrew.",
        state: "withdrawn",
        created_at: now,
      } as never);
    });

    const stats = await asAdmin.query(api.admin.overview.getReportStats, {});
    expect(stats.events.delivered_this_year).toBe(1);
    expect(stats.events.attendance_total).toBe(1);
    expect(stats.opportunities.posted).toBe(1);
    expect(stats.opportunities.applications_total).toBe(1);
    expect(stats.opportunities.results_recorded).toBe(1);
    expect(stats.members.total).toBeGreaterThanOrEqual(2);
    expect(stats.members.lifecycle_counts.active).toBeGreaterThanOrEqual(2);
    // Counts only: nothing row-shaped, no names, no emails.
    const raw = JSON.stringify(stats);
    expect(raw).not.toContain("@example.com");
    expect(raw).not.toContain("Test Member");
    expect(raw).not.toContain("Delivered Session");
    expect(raw).not.toContain("Posted Listing");
  });
});
