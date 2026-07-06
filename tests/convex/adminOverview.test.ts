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
  claimState: "unclaimed" | "claimed" | "conflict",
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
      // Members: one more active, one waiting on a guardian, one archived
      // (archived counts in NEITHER active nor waiting).
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

      // Legacy list: one claimed, one unclaimed, one conflict (the conflict row
      // is also the claim-conflicts queue's single open row).
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

      // One open row per remaining queue.
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
    });

    const counts = await asAdmin.query(api.admin.overview.getAdminOverview, {});
    expect(counts).toEqual({
      members_active: 2,
      members_waiting: 1,
      legacy_registered: 3,
      legacy_claimed: 1,
      queue_conflicts: 1,
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
