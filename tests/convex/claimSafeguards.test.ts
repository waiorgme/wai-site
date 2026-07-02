import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Claim-wave Gate 4 regressions: the claim path must enforce the same
// women-only pipeline rule as join/settings, refuse ambiguous duplicate-email
// records (Stage 0 conflict model), and never issue a migrated certificate
// without the member's legacy WAIME number.

const modules = import.meta.glob("../../convex/**/*.*s");

const ADULT_DOB = "1985-03-10";

const importedRow = (email: string, extra: Record<string, unknown> = {}) => ({
  legacy_row_id: `waime:${(extra.legacy_membership_number as number) ?? 101}`,
  legacy_row_hash: "testhash",
  normalized_email: email,
  name: "Amal Haddad",
  dob_if_known: ADULT_DOB,
  legacy_membership_number: 101,
  claim_state: "unclaimed" as const,
  match_signals: { email: false, name: false, mobile: false, dob: false },
  ...extra,
});

const signedInAs = async (
  t: ReturnType<typeof convexTest>,
  email: string,
) => {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  return t.withIdentity({ subject: `${userId}|testsession` });
};

const claimArgs = (extra: Record<string, unknown> = {}) => ({
  nameConfirmed: "Amal Haddad",
  dobAnswer: ADULT_DOB,
  genderAnswer: "female" as const,
  attestation: true,
  consents: { terms: true, marketing: false, pipeline: false },
  ...extra,
});

describe("duplicate-email conflict model (two people, one email)", () => {
  it("getMyClaimCandidate returns a neutral held state, revealing nothing", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("importedMembers", importedRow("shared@example.com"));
      await ctx.db.insert(
        "importedMembers",
        importedRow("shared@example.com", {
          legacy_row_id: "waime:202",
          legacy_membership_number: 202,
          name: "Someone Else",
        }),
      );
    });
    const asClaimant = await signedInAs(t, "shared@example.com");
    const candidate = await asClaimant.query(api.members.getMyClaimCandidate, {});
    expect(candidate).toEqual({ state: "held" });
  });

  it("matchClaim refuses, marks both rows conflict, creates no member", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("importedMembers", importedRow("shared@example.com"));
      await ctx.db.insert(
        "importedMembers",
        importedRow("shared@example.com", {
          legacy_row_id: "waime:202",
          legacy_membership_number: 202,
          name: "Someone Else",
        }),
      );
    });
    const asClaimant = await signedInAs(t, "shared@example.com");
    const result = await asClaimant.mutation(api.members.matchClaim, claimArgs());
    expect(result).toEqual({ ok: false, error: "held" });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("importedMembers").collect(),
    );
    expect(rows.every((r) => r.claim_state === "conflict")).toBe(true);
    expect(rows.every((r) => r.conflict_reason === "duplicate_email")).toBe(true);
    const members = await t.run(async (ctx) => ctx.db.query("members").collect());
    expect(members).toHaveLength(0);
  });
});

describe("legacy membership number is mandatory for a migrated certificate", () => {
  it("a claimable row without a legacy number is routed to review, no member, no cert", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "importedMembers",
        importedRow("nonum@example.com", {
          legacy_row_id: "email:nonum@example.com",
          legacy_membership_number: undefined,
        }),
      );
    });
    const asClaimant = await signedInAs(t, "nonum@example.com");
    const result = await asClaimant.mutation(api.members.matchClaim, claimArgs());
    expect(result).toEqual({ ok: false, error: "held" });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("importedMembers").collect(),
    );
    expect(rows[0].claim_state).toBe("conflict");
    expect(rows[0].conflict_reason).toBe("missing_legacy_number");
    expect(await t.run(async (ctx) => ctx.db.query("members").collect())).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("certificates").collect())).toHaveLength(0);
  });

  it("a successful claim issues the certificate with the LEGACY number, never the counter", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "importedMembers",
        importedRow("legacy@example.com", { legacy_membership_number: 347 }),
      );
    });
    const asClaimant = await signedInAs(t, "legacy@example.com");
    const result = await asClaimant.mutation(api.members.matchClaim, claimArgs());
    expect(result).toEqual({ ok: true });

    const certs = await t.run(async (ctx) =>
      ctx.db.query("certificates").collect(),
    );
    expect(certs).toHaveLength(1);
    expect(certs[0].membership_number).toBe(347);
  });
});

describe("claim-path pipeline lane guard (women-only, same rule as join)", () => {
  it("a male (ally lane) claim with pipeline ticked stores explicit false plus an audited refusal", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert(
        "importedMembers",
        importedRow("allyclaim@example.com", { gender: "male" }),
      );
    });
    const asClaimant = await signedInAs(t, "allyclaim@example.com");
    const result = await asClaimant.mutation(
      api.members.matchClaim,
      claimArgs({
        genderAnswer: "male" as const,
        consents: { terms: true, marketing: false, pipeline: true },
      }),
    );
    expect(result).toEqual({ ok: true });

    const consents = await t.run(async (ctx) =>
      ctx.db.query("consentRecords").collect(),
    );
    const pipeline = consents.filter((c) => c.type === "pipeline");
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0].value).toBe(false);

    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    const refusal = audits.filter((a) => a.action === "writeConsent.refused");
    expect(refusal).toHaveLength(1);
    expect(refusal[0].after_summary).toContain("lane=ally");
  });
});
