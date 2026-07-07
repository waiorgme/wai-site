import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// Partners admin (panel-experience spec §G16). Admin-managed relationship
// records: create/edit with enum + email validation, the committed-vs-
// delivered deliverable ledger, seal grant/withdraw, logo upload. Everything
// deny-by-default and audited.

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

const memberRow = (email: string) => ({
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
});

const signIn = async (t: ReturnType<typeof convexTest>, email: string) => {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { ...memberRow(email), userId });
  });
  return t.withIdentity({ subject: `${userId}|testsession` });
};

const createPartner = async (
  asAdmin: Awaited<ReturnType<typeof signIn>>,
): Promise<Id<"partners">> => {
  const result = await asAdmin.mutation(api.admin.partners.upsertPartner, {
    name: "Pier Seven Aviation",
    tier: "partner",
    status: "active",
    contact_name: "Omar Client",
    contact_email: "omar@pierseven.example",
    mou_signed_on: "2026-06-01",
    committed_value: "Funds type-rating training for up to two women",
    deliverables: [
      { label: "Two internships", status: "committed" },
      { label: "One workshop", status: "committed" },
    ],
  });
  expect(result.ok).toBe(true);
  return (result as { ok: true; partnerId: Id<"partners"> }).partnerId;
};

describe("partners admin: deny-by-default", () => {
  it("a non-admin member is refused everywhere", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const partnerId = await createPartner(asAdmin);
    const asMember = await signIn(t, NON_ADMIN);
    await expect(
      asMember.query(api.admin.partners.listPartners, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asMember.query(api.admin.partners.getPartner, { partnerId }),
    ).rejects.toThrow(/not_authorized/);
    expect(
      await asMember.mutation(api.admin.partners.upsertPartner, {
        name: "Sneaky Org",
        tier: "supporter",
        status: "prospect",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.partners.setDeliverableStatus, {
        partnerId,
        index: 0,
        status: "delivered",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.partners.setSeal, {
        partnerId,
        seal: "granted",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.partners.generateLogoUploadUrl, {}),
    ).toEqual({ ok: false, error: "not_authorized" });
  });

  it("an unauthenticated caller is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.admin.partners.listPartners, {})).rejects.toThrow(
      /not_authorized/,
    );
  });
});

describe("partner create / edit", () => {
  it("creates with safe defaults (seal none, not public, 12-month term) and audits", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const partnerId = await createPartner(asAdmin);
    const partner = await asAdmin.query(api.admin.partners.getPartner, {
      partnerId,
    });
    expect(partner?.seal).toBe("none");
    expect(partner?.show_publicly).toBe(false);
    expect(partner?.term_months).toBe(12);
    expect(partner?.contact_email).toBe("omar@pierseven.example");
    expect(partner?.deliverables).toHaveLength(2);
    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    const created = audits.find((a) => a.action === "upsertPartner");
    // Partner names in audit summaries are fine: org data, not member PII.
    expect(created?.after_summary).toContain("Pier Seven Aviation");
  });

  it("validates enum-adjacent fields at the boundary", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    expect(
      await asAdmin.mutation(api.admin.partners.upsertPartner, {
        name: "  ",
        tier: "supporter",
        status: "prospect",
      }),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(api.admin.partners.upsertPartner, {
        name: "Bad Email Org",
        tier: "supporter",
        status: "prospect",
        contact_email: "not-an-email",
      }),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(api.admin.partners.upsertPartner, {
        name: "Bad Term Org",
        tier: "supporter",
        status: "prospect",
        term_months: 0,
      }),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(api.admin.partners.upsertPartner, {
        name: "Bad Deliverable Org",
        tier: "supporter",
        status: "prospect",
        deliverables: [{ label: "  ", status: "committed" }],
      }),
    ).toEqual({ ok: false, error: "validation" });
  });

  it("updates an existing record and lists with a status filter", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const partnerId = await createPartner(asAdmin);
    await asAdmin.mutation(api.admin.partners.upsertPartner, {
      name: "Prospect Org",
      tier: "supporter",
      status: "prospect",
    });
    const updated = await asAdmin.mutation(api.admin.partners.upsertPartner, {
      partnerId,
      name: "Pier Seven Aviation",
      tier: "champion",
      status: "active",
      deliverables: [{ label: "Two internships", status: "committed" }],
    });
    expect(updated).toEqual({ ok: true, partnerId });
    const active = await asAdmin.query(api.admin.partners.listPartners, {
      status: "active",
    });
    expect(active).toHaveLength(1);
    expect(active[0].tier).toBe("champion");
    expect(active[0].deliverables_total).toBe(1);
    const all = await asAdmin.query(api.admin.partners.listPartners, {});
    expect(all).toHaveLength(2);
    // Editing a missing record is not_found, never an insert.
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("partners", {
        name: "Temp",
        tier: "supporter",
        status: "prospect",
        seal: "none",
        show_publicly: false,
        created_at: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    expect(
      await asAdmin.mutation(api.admin.partners.upsertPartner, {
        partnerId: gone,
        name: "Ghost Org",
        tier: "supporter",
        status: "prospect",
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("deliverables ledger", () => {
  it("moves one deliverable's status and audits before/after", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const partnerId = await createPartner(asAdmin);
    const result = await asAdmin.mutation(
      api.admin.partners.setDeliverableStatus,
      { partnerId, index: 0, status: "delivered" },
    );
    expect(result).toEqual({ ok: true });
    const partner = await asAdmin.query(api.admin.partners.getPartner, {
      partnerId,
    });
    expect(partner?.deliverables[0]).toEqual({
      label: "Two internships",
      status: "delivered",
    });
    expect(partner?.deliverables[1].status).toBe("committed");
    const list = await asAdmin.query(api.admin.partners.listPartners, {});
    expect(list[0].deliverables_delivered).toBe(1);
    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    const row = audits.find((a) => a.action === "setDeliverableStatus");
    expect(row?.before_summary).toContain("status=committed");
    expect(row?.after_summary).toContain("status=delivered");
    expect(row?.after_summary).toContain("Two internships");
    // Same status again: already done, no second audit row.
    expect(
      await asAdmin.mutation(api.admin.partners.setDeliverableStatus, {
        partnerId,
        index: 0,
        status: "delivered",
      }),
    ).toEqual({ ok: true, already: true });
    // Out-of-range index is a validation error.
    expect(
      await asAdmin.mutation(api.admin.partners.setDeliverableStatus, {
        partnerId,
        index: 9,
        status: "delivered",
      }),
    ).toEqual({ ok: false, error: "validation" });
  });
});

describe("seal", () => {
  it("grant and withdraw are audited; repeating is already done", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const partnerId = await createPartner(asAdmin);
    expect(
      await asAdmin.mutation(api.admin.partners.setSeal, {
        partnerId,
        seal: "granted",
      }),
    ).toEqual({ ok: true });
    expect(
      await asAdmin.mutation(api.admin.partners.setSeal, {
        partnerId,
        seal: "granted",
      }),
    ).toEqual({ ok: true, already: true });
    expect(
      await asAdmin.mutation(api.admin.partners.setSeal, {
        partnerId,
        seal: "withdrawn",
      }),
    ).toEqual({ ok: true });
    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    const sealRows = audits.filter((a) => a.action === "setSeal");
    expect(sealRows).toHaveLength(2);
    expect(sealRows[0].before_summary).toContain("seal=none");
    expect(sealRows[0].after_summary).toContain("seal=granted");
    expect(sealRows[1].after_summary).toContain("seal=withdrawn");
  });
});

describe("logo upload", () => {
  // convex-test's storage.store records size + sha256 but NO contentType, so
  // the SEC-4 accept path (a real image/png upload) cannot be driven through
  // the harness: a typeless blob reads as "" and is refused, which is exactly
  // the safe production behavior this asserts. The linked-logo display path
  // is proven by linking the blob directly.
  it("grants an upload URL, refuses an unvalidated blob, resolves a linked logo", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const partnerId = await createPartner(asAdmin);
    const urlResult = await asAdmin.mutation(
      api.admin.partners.generateLogoUploadUrl,
      {},
    );
    expect(urlResult.ok).toBe(true);
    const blobId = await t.run(async (ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      ),
    );
    // The harness strips the content type, so the strict validator refuses:
    // no unvalidated blob is ever linked as a logo.
    expect(
      await asAdmin.mutation(api.admin.partners.setPartnerLogo, {
        partnerId,
        storageId: blobId,
      }),
    ).toEqual({ ok: false, error: "validation" });
    const before = await asAdmin.query(api.admin.partners.getPartner, {
      partnerId,
    });
    expect(before?.logo_url).toBeNull();
    // A stored logo resolves to a URL on the detail view.
    await t.run(async (ctx) => {
      await ctx.db.patch(partnerId, { logo_storage_id: blobId });
    });
    const after = await asAdmin.query(api.admin.partners.getPartner, {
      partnerId,
    });
    expect(after?.logo_url).not.toBeNull();
  });
});

describe("partner website + free-text boundaries (Gate 4 round 2)", () => {
  it("website must be https and bounded; oversized free text is refused, not truncated", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const base = {
      name: "Boundary Org",
      tier: "supporter" as const,
      status: "prospect" as const,
    };
    for (const bad of [
      { website: "http://partner.example" },
      { website: "javascript:alert(1)" },
      { website: `https://partner.example/${"x".repeat(500)}` },
      { contact_name: "x".repeat(161) },
      { committed_value: "x".repeat(161) },
      { mou_signed_on: "x".repeat(41) },
      { notes: "x".repeat(2001) },
    ]) {
      expect(
        await asAdmin.mutation(api.admin.partners.upsertPartner, {
          ...base,
          ...bad,
        }),
      ).toEqual({ ok: false, error: "validation" });
    }
    const ok = await asAdmin.mutation(api.admin.partners.upsertPartner, {
      ...base,
      website: "https://partner.example",
      notes: "Met at the aviation summit.",
    });
    expect(ok.ok).toBe(true);
    const partnerId = (ok as { ok: true; partnerId: Id<"partners"> }).partnerId;
    const partner = await asAdmin.query(api.admin.partners.getPartner, {
      partnerId,
    });
    expect(partner?.website).toBe("https://partner.example");
    expect(partner?.notes).toBe("Met at the aviation summit.");
  });
});
