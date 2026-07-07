import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// Admin vs super-admin separation (Gate 4 blocker, 2026-07-07; Stage 0 §3):
// admin = Mervat + the named backup (ADMIN_EMAILS), super_admin = Issam
// (SUPER_ADMIN_EMAILS). A plain admin runs the console and every queue;
// certificate revoke/re-issue stay super-only. Deny-by-default holds when
// both env vars are empty.

const modules = import.meta.glob("../../convex/**/*.*s");

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => ({ error: null }),
    };
  },
}));

const SUPER_EMAIL = "issam@example.com";
const ADMIN_EMAIL = "mervat@example.com";
const MEMBER_EMAIL = "member@example.com";

beforeEach(() => {
  process.env.SUPER_ADMIN_EMAILS = SUPER_EMAIL;
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  process.env.AUTH_RESEND_KEY = "test-key";
  process.env.SITE_URL = "http://localhost:4321";
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

const signIn = async (t: ReturnType<typeof convexTest>, email: string) => {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { ...memberRow(email), userId });
  });
  return t.withIdentity({ subject: `${userId}|testsession` });
};

const insertCertificate = async (
  t: ReturnType<typeof convexTest>,
): Promise<Id<"certificates">> =>
  t.run(async (ctx) => {
    const memberId = await ctx.db.insert(
      "members",
      memberRow("holder@example.com") as never,
    );
    return ctx.db.insert("certificates", {
      member_id: memberId,
      type: "membership",
      verify_token: "tok-roles",
      membership_number: 2001,
      recipient_name: "Holder Name",
      issued_at: Date.now(),
      issued_date_label: "1 July 2026",
      is_founding: false,
      status: "valid",
      template_version: "membership-2026-06",
      idempotency_key: "membership:roles-test",
    });
  });

describe("myAdminRole (the UI courtesy probe)", () => {
  it("answers super_admin / admin / null by allowlist", async () => {
    const t = convexTest(schema, modules);
    const asSuper = await signIn(t, SUPER_EMAIL);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const asMember = await signIn(t, MEMBER_EMAIL);
    expect(await asSuper.query(api.lib.adminAuth.myAdminRole, {})).toBe(
      "super_admin",
    );
    expect(await asAdmin.query(api.lib.adminAuth.myAdminRole, {})).toBe("admin");
    expect(await asMember.query(api.lib.adminAuth.myAdminRole, {})).toBeNull();
  });
});

describe("a plain admin runs the console", () => {
  it("overview, members, events (read + audited write), partners, queues, audit log all open", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);

    const counts = await asAdmin.query(api.admin.overview.getAdminOverview, {});
    expect(counts.members_active).toBeGreaterThanOrEqual(1);
    expect(
      (await asAdmin.query(api.admin.members.listMembers, {})).total,
    ).toBeGreaterThanOrEqual(1);
    expect(await asAdmin.query(api.admin.events.adminListEvents, {})).toEqual([]);
    expect(await asAdmin.query(api.admin.partners.listPartners, {})).toEqual([]);
    expect(
      (await asAdmin.query(api.admin.audit.listAdminAuditLog, {})).rows,
    ).toEqual([]);

    // A write flows and the audit actor is HER email.
    const created = await asAdmin.mutation(api.admin.events.upsertEvent, {
      title: "Story Session",
      category: "story_session",
      short_description: "A member shares her path.",
      starts_at: Date.now() + 86400000,
      ends_at: Date.now() + 90000000,
      format: "online",
      audience_lane: "adult",
    });
    expect(created.ok).toBe(true);
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    const row = audits.find((a) => a.action === "upsertEvent");
    expect(row?.actor).toBe(ADMIN_EMAIL);
  });

  it("certificate powers stay super-only: list throws, revoke and re-issue refuse", async () => {
    const t = convexTest(schema, modules);
    const certId = await insertCertificate(t);
    const asAdmin = await signIn(t, ADMIN_EMAIL);

    await expect(
      asAdmin.query(api.admin.certificates.listCertificates, {}),
    ).rejects.toThrow(/not_authorized/);
    expect(
      await asAdmin.mutation(api.admin.certificates.revokeCertificate, {
        certificateId: certId,
        reason: "Issued in error.",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asAdmin.mutation(api.admin.certificates.reissueCertificate, {
        certificateId: certId,
        correctedName: "Corrected Name",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });

    // The super admin retains them.
    const asSuper = await signIn(t, SUPER_EMAIL);
    expect(
      await asSuper.mutation(api.admin.certificates.revokeCertificate, {
        certificateId: certId,
        reason: "Issued in error.",
      }),
    ).toEqual({ ok: true });
  });
});

describe("deny-by-default still holds", () => {
  it("an unlisted member is refused everywhere; empty allowlists admit no one", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, MEMBER_EMAIL);
    await expect(
      asMember.query(api.admin.overview.getAdminOverview, {}),
    ).rejects.toThrow(/not_authorized/);

    process.env.ADMIN_EMAILS = "";
    process.env.SUPER_ADMIN_EMAILS = "";
    const asFormerAdmin = await signIn(t, "was-admin@example.com");
    await expect(
      asFormerAdmin.query(api.admin.overview.getAdminOverview, {}),
    ).rejects.toThrow(/not_authorized/);
  });
});
