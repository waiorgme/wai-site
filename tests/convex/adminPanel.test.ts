import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Admin-panel Gate 1 integration tests (spec criterion 11). The admin identity
// is a deployment env var (SUPER_ADMIN_EMAILS) checked server-side on every
// admin query/mutation; deny-by-default. These drive the real functions through
// convex-test, injecting the allowlist via process.env (never a live
// deployment). Resend is mocked for the guardian-resend path.

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

const ADMIN_EMAIL = "issam@example.com";
const OTHER_ADMIN = "mervat@example.com";
const NON_ADMIN = "member@example.com";

beforeEach(() => {
  sentEmails.length = 0;
  process.env.SUPER_ADMIN_EMAILS = `${ADMIN_EMAIL},${OTHER_ADMIN}`;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  process.env.AUTH_RESEND_KEY = "test-key";
  process.env.SITE_URL = "http://localhost:4321";
});

afterEach(() => {
  vi.restoreAllMocks();
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

// An authenticated auth-user with NO linked member row: authorization must deny
// (criterion 1 authorizes the signed-in MEMBER, not any allowlisted auth-user).
const signInAuthOnly = async (
  t: ReturnType<typeof convexTest>,
  email: string,
) => {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  return t.withIdentity({ subject: `${userId}|testsession` });
};

describe("admin auth gate: deny-by-default, neutral errors", () => {
  it("a non-admin member is refused on every new query", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    await expect(asMember.query(api.admin.claims.listConflicts, {})).rejects.toThrow(
      /not_authorized/,
    );
    await expect(
      asMember.query(api.admin.pipelineReviews.listPendingReviews, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asMember.query(api.admin.guardians.listPendingGuardians, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asMember.query(api.admin.dataRequests.listDataRequests, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asMember.query(api.admin.audit.listAdminAuditLog, {}),
    ).rejects.toThrow(/not_authorized/);
  });

  it("an unauthenticated caller is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.admin.claims.listConflicts, {})).rejects.toThrow(
      /not_authorized/,
    );
  });

  it("amISuperAdmin is a courtesy boolean: false for non-admin and signed out", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.lib.adminAuth.amISuperAdmin, {})).toBe(false);
    const asMember = await signIn(t, NON_ADMIN);
    expect(await asMember.query(api.lib.adminAuth.amISuperAdmin, {})).toBe(false);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    expect(await asAdmin.query(api.lib.adminAuth.amISuperAdmin, {})).toBe(true);
  });

  it("deny-by-default: an empty allowlist locks even a would-be admin out", async () => {
    process.env.SUPER_ADMIN_EMAILS = "";
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    expect(await asAdmin.query(api.lib.adminAuth.amISuperAdmin, {})).toBe(false);
    await expect(asAdmin.query(api.admin.claims.listConflicts, {})).rejects.toThrow(
      /not_authorized/,
    );
  });

  it("an allowlisted auth-user with NO member row is denied on every admin function", async () => {
    const t = convexTest(schema, modules);
    // Signed in, email IS on the allowlist, but there is no linked member row.
    const asGhost = await signInAuthOnly(t, ADMIN_EMAIL);
    expect(await asGhost.query(api.lib.adminAuth.amISuperAdmin, {})).toBe(false);
    await expect(asGhost.query(api.admin.claims.listConflicts, {})).rejects.toThrow(
      /not_authorized/,
    );
    await expect(
      asGhost.query(api.admin.pipelineReviews.listPendingReviews, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asGhost.query(api.admin.guardians.listPendingGuardians, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asGhost.query(api.admin.dataRequests.listDataRequests, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asGhost.query(api.admin.audit.listAdminAuditLog, {}),
    ).rejects.toThrow(/not_authorized/);
    // Mutations and the action gate deny too.
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", {
        legacy_row_id: "waime:g",
        legacy_row_hash: "gh",
        normalized_email: "g@example.com",
        name: "Ghost Row",
        claim_state: "conflict" as const,
        conflict_reason: "duplicate_email",
        match_signals: { email: true, name: false, mobile: false, dob: false },
      }),
    );
    expect(
      await asGhost.mutation(api.admin.claims.resolveConflictAsClaimed, { rowId }),
    ).toEqual({ ok: false, error: "not_authorized" });
    const someMemberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("target@example.com")),
    );
    // The admin ACTION returns the neutral envelope (does not throw) for an
    // unauthorized caller, matching the mutation contract.
    expect(
      await asGhost.action(api.guardians.resendGuardianEmailFromPanel, {
        memberId: someMemberId,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
  });
});

describe("claim conflicts queue", () => {
  it("an admin lists conflict + suppressed_minor rows, masked", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    await t.run(async (ctx) => {
      await ctx.db.insert("importedMembers", {
        legacy_row_id: "waime:1",
        legacy_row_hash: "h1",
        normalized_email: "dup@example.com",
        name: "Amira Al Farsi",
        claim_state: "conflict",
        conflict_reason: "duplicate_email",
        match_signals: { email: true, name: false, mobile: false, dob: false },
      });
      await ctx.db.insert("importedMembers", {
        legacy_row_id: "waime:2",
        legacy_row_hash: "h2",
        normalized_email: "kid@example.com",
        name: "Sara Hassan",
        claim_state: "suppressed_minor",
        match_signals: { email: true, name: true, mobile: false, dob: true },
      });
    });
    const rows = await asAdmin.query(api.admin.claims.listConflicts, {});
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.masked_name).sort();
    expect(names).toEqual(["Amira F.", "Sara H."]);
    // The full NAME never leaks (masked); the email IS shown deliberately, as
    // the conflict key the admin must act on (criterion 2, same reasoning as the
    // data-request queue's subject_email).
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain("Al Farsi");
    }
    expect(rows.map((r) => r.normalized_email).sort()).toEqual([
      "dup@example.com",
      "kid@example.com",
    ]);
  });
});

describe("claim conflict resolution (correct + archive, decided 2026-07-04)", () => {
  const conflictRow = (
    email: string,
    extra: Record<string, unknown> = {},
  ) => ({
    legacy_row_id: `waime:${(extra.legacy_membership_number as number) ?? 101}`,
    legacy_row_hash: "h",
    normalized_email: email,
    name: "Amal Haddad",
    dob_if_known: "1985-03-10",
    legacy_membership_number: 101,
    claim_state: "conflict" as const,
    conflict_reason: "duplicate_email",
    match_signals: { email: true, name: false, mobile: false, dob: false },
    ...extra,
  });

  it("happy path: conflict -> unclaimed, note appended, PII-free audit written", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("solo@example.com")),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId,
      note: "confirmed by reply from the email on file",
    });
    expect(res).toEqual({ ok: true, state: "unclaimed" });

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row?.claim_state).toBe("unclaimed");
    expect(row?.conflict_reason).toContain("duplicate_email");
    expect(row?.conflict_reason).toContain("resolved by admin");
    expect(row?.conflict_reason).toContain("confirmed by reply");

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "resolveConflictAsClaimed"))
        .collect(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].source).toBe("admin_fallback");
    expect(audits[0].actor).toBe(ADMIN_EMAIL);
    // PII-free + no raw note: the summary is structured only.
    expect(audits[0].after_summary).not.toContain("solo@example.com");
    expect(audits[0].after_summary).not.toContain("Amal");
    expect(audits[0].after_summary).not.toContain("confirmed by reply");
    expect(audits[0].after_summary).toContain("note_present=true");
  });

  it("corrected-email path releases to the new email", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("shared@example.com")),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId,
      correctedEmail: "Corrected@Example.com",
    });
    expect(res).toEqual({ ok: true, state: "unclaimed" });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row?.normalized_email).toBe("corrected@example.com");
    expect(row?.claim_state).toBe("unclaimed");
  });

  it("corrected email is rejected if it collides with a non-conflict row", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("shared@example.com")),
    );
    // A claimable (unclaimed) row already sits at the corrected email.
    await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("taken@example.com", {
          legacy_row_id: "waime:999",
          legacy_membership_number: 999,
          claim_state: "unclaimed",
          conflict_reason: undefined,
        }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId,
      correctedEmail: "taken@example.com",
    });
    expect(res).toEqual({ ok: false, error: "email_collision" });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    // Unchanged: still a conflict at its original email.
    expect(row?.claim_state).toBe("conflict");
    expect(row?.normalized_email).toBe("shared@example.com");
  });

  it("corrected email colliding with a LIVE conflict row is refused (it would re-conflict)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("a@example.com")),
    );
    await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("live@example.com", {
          legacy_row_id: "waime:888",
          legacy_membership_number: 888,
        }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId,
      correctedEmail: "live@example.com",
    });
    expect(res).toEqual({ ok: false, error: "email_collision" });
  });

  it("corrected email colliding only with an ARCHIVED conflict row is allowed (that is the trail)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("a@example.com")),
    );
    await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("trail@example.com", {
          legacy_row_id: "waime:888",
          legacy_membership_number: 888,
          claim_state: "archived_conflict",
        }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId,
      correctedEmail: "trail@example.com",
    });
    expect(res).toEqual({ ok: true, state: "unclaimed" });
  });

  it("release WITHOUT a unique email is refused while the pair is still live (duplicate_unresolved)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const verifiedId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("dup@example.com")),
    );
    await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("dup@example.com", {
          legacy_row_id: "waime:202",
          legacy_membership_number: 202,
          name: "Someone Else",
        }),
      ),
    );
    // No corrected email, pair still live at the same address -> refused.
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId: verifiedId,
    });
    expect(res).toEqual({ ok: false, error: "duplicate_unresolved" });
    const row = await t.run(async (ctx) => ctx.db.get(verifiedId));
    expect(row?.claim_state).toBe("conflict");
  });

  it("archive-then-release-without-corrected-email works once the pair is archived", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const verifiedId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("dup@example.com", { name: "Amal Haddad" })),
    );
    const otherId = await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("dup@example.com", {
          legacy_row_id: "waime:202",
          legacy_membership_number: 202,
          name: "Someone Else",
        }),
      ),
    );
    // Archive the other row first...
    const archiveRes = await asAdmin.mutation(api.admin.claims.archiveConflictRow, {
      rowId: otherId,
    });
    expect(archiveRes).toEqual({ ok: true, state: "archived_conflict" });
    // ...now the verified row can be released at the SAME email (no correction).
    const releaseRes = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId: verifiedId,
    });
    expect(releaseRes).toEqual({ ok: true, state: "unclaimed" });

    // Amal claims through the normal path at dup@example.com; the archived row
    // is ignored by the duplicate count.
    const asAmal = await t.run(async (ctx) => ctx.db.insert("users", { email: "dup@example.com" }));
    const amalSession = t.withIdentity({ subject: `${asAmal}|testsession` });
    const claim = await amalSession.mutation(api.members.matchClaim, {
      nameConfirmed: "Amal Haddad",
      dobAnswer: "1985-03-10",
      genderAnswer: "female",
      attestation: true,
      consents: { terms: true, marketing: false, pipeline: false },
    });
    expect(claim).toMatchObject({ ok: true });
  });

  it("resolving one row of a duplicate-email pair NEVER touches the other; the other stays conflict", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const verifiedId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("pair@example.com")),
    );
    const otherId = await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("pair@example.com", {
          legacy_row_id: "waime:202",
          legacy_membership_number: 202,
          name: "Someone Else",
        }),
      ),
    );
    // Archive the non-matching row by its OWN explicit call (while it still
    // shares the email, so it is a genuine duplicate): it moves to
    // archived_conflict, permanent and never claimable.
    const archiveRes = await asAdmin.mutation(api.admin.claims.archiveConflictRow, {
      rowId: otherId,
      note: "duplicate belongs to a different person",
    });
    expect(archiveRes).toEqual({ ok: true, state: "archived_conflict" });

    // Resolving the verified row NEVER touched the archived one beyond its own
    // explicit archive: releasing the verified row leaves the archived row as it
    // was (still archived_conflict, still at the shared email).
    await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId: verifiedId,
    });
    const archived = await t.run(async (ctx) => ctx.db.get(otherId));
    expect(archived?.claim_state).toBe("archived_conflict");
    expect(archived?.normalized_email).toBe("pair@example.com");
    expect(archived?.conflict_reason).toContain("archived as conflict");

    // PII-free audit: the raw note is on the row, never in the audit summary.
    const archiveAudit = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "archiveConflictRow"))
        .collect(),
    );
    expect(archiveAudit).toHaveLength(1);
    expect(archiveAudit[0].after_summary).not.toContain("different person");
    expect(archiveAudit[0].after_summary).toContain("archived_conflict");
  });

  it("a released row is claimable through matchClaim again while its archived pair is not", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    // A duplicate-email pair, both conflict.
    const verifiedId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("dup@example.com", { name: "Amal Haddad" })),
    );
    await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("dup@example.com", {
          legacy_row_id: "waime:202",
          legacy_membership_number: 202,
          name: "Someone Else",
        }),
      ),
    );
    // Correct the verified row onto the person's real email and release it.
    await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId: verifiedId,
      correctedEmail: "amal@example.com",
    });
    // Now Amal signs in with her corrected email and claims through the NORMAL
    // path (no shortcut past matchClaim's safeguards).
    const asAmal = await t.run(async (ctx) => ctx.db.insert("users", { email: "amal@example.com" }));
    const amalSession = t.withIdentity({ subject: `${asAmal}|testsession` });
    const claim = await amalSession.mutation(api.members.matchClaim, {
      nameConfirmed: "Amal Haddad",
      dobAnswer: "1985-03-10",
      genderAnswer: "female",
      attestation: true,
      consents: { terms: true, marketing: false, pipeline: false },
    });
    expect(claim).toMatchObject({ ok: true });
    const member = await t.run(async (ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_email", (q) => q.eq("email", "amal@example.com"))
        .unique(),
    );
    expect(member).not.toBeNull();

    // The archived pair (still at dup@example.com, still conflict) is NOT
    // claimable: a claimant on that email gets the neutral held state.
    const asOther = await t.run(async (ctx) => ctx.db.insert("users", { email: "dup@example.com" }));
    const otherSession = t.withIdentity({ subject: `${asOther}|testsession` });
    const candidate = await otherSession.query(api.members.getMyClaimCandidate, {});
    // A single conflict row at that email is not claimable (claimableRow only
    // returns unclaimed / aged-up suppressed_minor rows).
    expect(candidate === null || candidate.state === "held").toBe(true);
  });

  it("a non-admin cannot resolve or archive a conflict (neutral not_authorized)", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("x@example.com")),
    );
    expect(
      await asMember.mutation(api.admin.claims.resolveConflictAsClaimed, { rowId }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.claims.archiveConflictRow, { rowId }),
    ).toEqual({ ok: false, error: "not_authorized" });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row?.claim_state).toBe("conflict");
  });

  it("resolving a non-conflict row (e.g. suppressed_minor) is refused with the neutral shape", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("minor@example.com", { claim_state: "suppressed_minor", conflict_reason: undefined }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId,
    });
    expect(res).toEqual({ ok: false, error: "not_found" });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row?.claim_state).toBe("suppressed_minor");
  });

  it("archiving a single (unique-email) DOB-mismatch conflict is refused (not_duplicate)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    // A lone conflict whose email no other imported row shares.
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("solo-dob@example.com", {
          conflict_reason: "dob_mismatch_at_claim",
        }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.archiveConflictRow, {
      rowId,
    });
    expect(res).toEqual({ ok: false, error: "not_duplicate" });
    // It stays in review, never permanently parked.
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row?.claim_state).toBe("conflict");
  });

  it("archiving one row of a genuine duplicate-email pair works", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("pairdup@example.com")),
    );
    await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("pairdup@example.com", {
          legacy_row_id: "waime:303",
          legacy_membership_number: 303,
          name: "Someone Else",
        }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.archiveConflictRow, {
      rowId,
    });
    expect(res).toEqual({ ok: true, state: "archived_conflict" });
  });

  it("corrected-email resolution ATOMICALLY archives the leftover pair row", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const verifiedId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("dup@example.com", { name: "Amal Haddad" })),
    );
    const leftoverId = await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("dup@example.com", {
          legacy_row_id: "waime:202",
          legacy_membership_number: 202,
          name: "Someone Else",
        }),
      ),
    );
    // Release the verified row onto a corrected email in ONE mutation.
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId: verifiedId,
      correctedEmail: "amal@example.com",
    });
    expect(res).toEqual({ ok: true, state: "unclaimed" });

    // Exactly one released row + one archived_conflict row.
    const verified = await t.run(async (ctx) => ctx.db.get(verifiedId));
    const leftover = await t.run(async (ctx) => ctx.db.get(leftoverId));
    expect(verified?.claim_state).toBe("unclaimed");
    expect(verified?.normalized_email).toBe("amal@example.com");
    expect(leftover?.claim_state).toBe("archived_conflict");
    expect(leftover?.normalized_email).toBe("dup@example.com");

    // The leftover archive was audited under the admin.
    const archiveAudit = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "archiveConflictRow"))
        .collect(),
    );
    expect(archiveAudit).toHaveLength(1);
    expect(archiveAudit[0].actor).toBe(ADMIN_EMAIL);

    // The archived leftover can NEVER be released, now or ever.
    const releaseArchived = await asAdmin.mutation(
      api.admin.claims.resolveConflictAsClaimed,
      { rowId: leftoverId },
    );
    expect(releaseArchived).toEqual({ ok: false, error: "not_found" });
    const stillArchived = await t.run(async (ctx) => ctx.db.get(leftoverId));
    expect(stillArchived?.claim_state).toBe("archived_conflict");
  });

  it("an archived_conflict row is refused release (never releasable)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("archived@example.com", { claim_state: "archived_conflict" }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId,
    });
    expect(res).toEqual({ ok: false, error: "not_found" });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row?.claim_state).toBe("archived_conflict");
  });

  it("corrected-email release is REFUSED (nothing changed) if a suppressed_minor shares the email", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const verifiedId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("shared@example.com")),
    );
    // A suppressed_minor row at the SAME email must never be auto-parked
    // (safeguarding: read-only, clears only on age-up).
    const minorId = await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("shared@example.com", {
          legacy_row_id: "waime:501",
          legacy_membership_number: 501,
          name: "Young One",
          claim_state: "suppressed_minor",
          conflict_reason: undefined,
        }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId: verifiedId,
      correctedEmail: "amal@example.com",
    });
    expect(res).toEqual({ ok: false, error: "duplicate_unresolved" });
    // Nothing changed: both rows are exactly as they were.
    const verified = await t.run(async (ctx) => ctx.db.get(verifiedId));
    const minor = await t.run(async (ctx) => ctx.db.get(minorId));
    expect(verified?.claim_state).toBe("conflict");
    expect(verified?.normalized_email).toBe("shared@example.com");
    expect(minor?.claim_state).toBe("suppressed_minor");
    expect(minor?.normalized_email).toBe("shared@example.com");
  });

  it("corrected-email release is REFUSED (nothing changed) if a claimed row shares the email", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const verifiedId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("shared2@example.com")),
    );
    const claimedId = await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("shared2@example.com", {
          legacy_row_id: "waime:502",
          legacy_membership_number: 502,
          name: "Already Claimed",
          claim_state: "claimed",
          conflict_reason: undefined,
        }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId: verifiedId,
      correctedEmail: "amal2@example.com",
    });
    expect(res).toEqual({ ok: false, error: "duplicate_unresolved" });
    const verified = await t.run(async (ctx) => ctx.db.get(verifiedId));
    const claimed = await t.run(async (ctx) => ctx.db.get(claimedId));
    expect(verified?.claim_state).toBe("conflict");
    expect(claimed?.claim_state).toBe("claimed");
  });

  it("corrected-email release still works when the ONLY other row is the conflict pair", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const verifiedId = await t.run(async (ctx) =>
      ctx.db.insert("importedMembers", conflictRow("paironly@example.com")),
    );
    const pairId = await t.run(async (ctx) =>
      ctx.db.insert(
        "importedMembers",
        conflictRow("paironly@example.com", {
          legacy_row_id: "waime:503",
          legacy_membership_number: 503,
          name: "The Other Half",
        }),
      ),
    );
    const res = await asAdmin.mutation(api.admin.claims.resolveConflictAsClaimed, {
      rowId: verifiedId,
      correctedEmail: "amal3@example.com",
    });
    expect(res).toEqual({ ok: true, state: "unclaimed" });
    const verified = await t.run(async (ctx) => ctx.db.get(verifiedId));
    const pair = await t.run(async (ctx) => ctx.db.get(pairId));
    expect(verified?.claim_state).toBe("unclaimed");
    expect(pair?.claim_state).toBe("archived_conflict");
  });
});

// A true, attested pipeline consent row (what join/claim/settings write). This
// IS the attestation signal the approval path now requires.
const seedPipelineConsent = async (
  t: ReturnType<typeof convexTest>,
  memberId: string,
) => {
  await t.run(async (ctx) =>
    ctx.db.insert("consentRecords", {
      member_id: memberId as never,
      type: "pipeline",
      value: true,
      policy_version: "test",
      source: "settings",
      timestamp: Date.now(),
    }),
  );
};

describe("pipeline reviews queue", () => {
  it("an admin lists a pending review (with consent evidence) and approves it end-to-end", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    // A standard-lane, ACTIVE member with a pending review AND a true attested
    // pipeline consent on record (the invariant approval now enforces).
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("candidate@example.com", { pipeline_state: "review_pending" })),
    );
    await seedPipelineConsent(t, memberId);
    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("pipelineEligibilityReviews", {
        member_id: memberId,
        state: "pending",
        timestamp: Date.now(),
      }),
    );

    const list = await asAdmin.query(api.admin.pipelineReviews.listPendingReviews, {});
    expect(list).toHaveLength(1);
    expect(list[0].reviewId).toBe(reviewId);
    expect(list[0].lane).toBe("standard");
    // The consent evidence is surfaced to the admin before she confirms.
    expect(list[0].consent_on_file).toBe(true);
    expect(list[0].consent_source).toBe("settings");
    expect(list[0].consent_date).not.toBeNull();

    const res = await asAdmin.mutation(
      api.admin.pipelineReviews.decidePipelineReviewFromPanel,
      { reviewId, decision: "approved", reason: "looks fine, DOB confirmed" },
    );
    expect(res).toMatchObject({ ok: true, state: "approved" });

    const member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.pipeline_state).toBe("on");

    const review = await t.run(async (ctx) => ctx.db.get(reviewId));
    // reviewer is the AUTHENTICATED admin, never a free-text field; the detailed
    // reason stays on the review row.
    expect(review?.reviewer).toBe(ADMIN_EMAIL);
    expect(review?.reason).toBe("looks fine, DOB confirmed");

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "decidePipelineReview"))
        .collect(),
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const last = audits[audits.length - 1];
    expect(last.source).toBe("admin_fallback");
    expect(last.actor).toBe(ADMIN_EMAIL);
    // PII-free + no raw reason in the immutable audit summary.
    expect(last.after_summary).not.toContain("DOB confirmed");
    expect(last.after_summary).toContain("reason_present=true");
  });

  it("REFUSES approval when the member has no true pipeline consent on record", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    // Standard + active, pending review, but NO consent row: approval must fail
    // (this replaces the old fixture that encoded the attestation-bypass bug).
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("nocandidate@example.com", { pipeline_state: "review_pending" })),
    );
    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("pipelineEligibilityReviews", {
        member_id: memberId,
        state: "pending",
        timestamp: Date.now(),
      }),
    );
    const list = await asAdmin.query(api.admin.pipelineReviews.listPendingReviews, {});
    expect(list[0].consent_on_file).toBe(false);

    const res = await asAdmin.mutation(
      api.admin.pipelineReviews.decidePipelineReviewFromPanel,
      { reviewId, decision: "approved" },
    );
    expect(res).toEqual({ ok: false, error: "not_permitted" });
    const member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.pipeline_state).toBe("review_pending");
    const review = await t.run(async (ctx) => ctx.db.get(reviewId));
    expect(review?.state).toBe("pending");
  });

  it("REFUSES approval when the latest pipeline consent is false (withdrawn)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("withdrew@example.com", { pipeline_state: "review_pending" })),
    );
    // An older true consent, then a newer false one: the LATEST wins.
    await t.run(async (ctx) => {
      await ctx.db.insert("consentRecords", {
        member_id: memberId,
        type: "pipeline",
        value: true,
        policy_version: "test",
        source: "settings",
        timestamp: Date.now() - 1000,
      });
      await ctx.db.insert("consentRecords", {
        member_id: memberId,
        type: "pipeline",
        value: false,
        policy_version: "test",
        source: "settings",
        timestamp: Date.now(),
      });
    });
    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("pipelineEligibilityReviews", {
        member_id: memberId,
        state: "pending",
        timestamp: Date.now(),
      }),
    );
    const res = await asAdmin.mutation(
      api.admin.pipelineReviews.decidePipelineReviewFromPanel,
      { reviewId, decision: "approved" },
    );
    expect(res).toEqual({ ok: false, error: "not_permitted" });
  });

  it("REFUSES approval when the member is not active, even with consent", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert(
        "members",
        memberRow("pending@example.com", {
          pipeline_state: "review_pending",
          lifecycle_state: "pending_review",
        }),
      ),
    );
    await seedPipelineConsent(t, memberId);
    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("pipelineEligibilityReviews", {
        member_id: memberId,
        state: "pending",
        timestamp: Date.now(),
      }),
    );
    const res = await asAdmin.mutation(
      api.admin.pipelineReviews.decidePipelineReviewFromPanel,
      { reviewId, decision: "approved" },
    );
    expect(res).toEqual({ ok: false, error: "not_permitted" });
  });

  it("allows REJECTION without a consent row (rejection withdraws, never grants)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("reject@example.com", { pipeline_state: "review_pending" })),
    );
    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("pipelineEligibilityReviews", {
        member_id: memberId,
        state: "pending",
        timestamp: Date.now(),
      }),
    );
    const res = await asAdmin.mutation(
      api.admin.pipelineReviews.decidePipelineReviewFromPanel,
      { reviewId, decision: "rejected" },
    );
    expect(res).toMatchObject({ ok: true, state: "rejected" });
    const member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.pipeline_state).toBe("rejected");
  });

  it("refuses to approve a review whose member is not standard lane", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("ally@example.com", { member_lane: "ally", gender: "male" })),
    );
    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("pipelineEligibilityReviews", {
        member_id: memberId,
        state: "pending",
        timestamp: Date.now(),
      }),
    );
    const res = await asAdmin.mutation(
      api.admin.pipelineReviews.decidePipelineReviewFromPanel,
      { reviewId, decision: "approved" },
    );
    expect(res).toEqual({ ok: false, error: "not_permitted" });
  });

  it("a non-admin gets the neutral envelope (not a throw) from the decide mutation", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("candidate2@example.com", { pipeline_state: "review_pending" })),
    );
    const reviewId = await t.run(async (ctx) =>
      ctx.db.insert("pipelineEligibilityReviews", {
        member_id: memberId,
        state: "pending",
        timestamp: Date.now(),
      }),
    );
    const res = await asMember.mutation(
      api.admin.pipelineReviews.decidePipelineReviewFromPanel,
      { reviewId, decision: "approved" },
    );
    expect(res).toEqual({ ok: false, error: "not_authorized" });
    // No state change.
    const review = await t.run(async (ctx) => ctx.db.get(reviewId));
    expect(review?.state).toBe("pending");
  });
});

describe("pending guardians queue", () => {
  it("an admin lists a pending guardian and resends the email (no confirm path)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert(
        "members",
        memberRow("minor@example.com", {
          name: "Lina Yousef",
          member_lane: "minor",
          lifecycle_state: "pending_guardian",
          guardian_consent_state: "pending",
        }),
      ),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("guardianConsents", {
        member_id: memberId,
        guardian_name: "Omar Yousef",
        guardian_email: "guardian@example.com",
        confirmation_state: "pending",
        confirmation_token_hash: "prevhash",
        token_sent_at: Date.now() - 1000,
        timestamp: Date.now(),
      });
    });

    const rows = await asAdmin.query(api.admin.guardians.listPendingGuardians, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].member_first_name).toBe("Lina");
    expect(rows[0].masked_guardian_name).toBe("Omar Y.");
    // Full guardian email never leaves the server.
    expect(JSON.stringify(rows[0])).not.toContain("guardian@example.com");

    const res = await asAdmin.action(
      api.guardians.resendGuardianEmailFromPanel,
      { memberId },
    );
    expect(res).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual(["guardian@example.com"]);

    // The consent is STILL pending: resending never confirms.
    const consent = await t.run(async (ctx) =>
      ctx.db
        .query("guardianConsents")
        .withIndex("by_member", (q) => q.eq("member_id", memberId))
        .first(),
    );
    expect(consent?.confirmation_state).toBe("pending");

    // The admin action is attributed to the admin in the audit view (blocker 1):
    // an admin_fallback row keyed to the admin, guardian-PII-free.
    const page = await asAdmin.query(api.admin.audit.listAdminAuditLog, {});
    const resendRow = page.rows.find(
      (r) => r.action === "resendGuardianEmailFromPanel",
    );
    expect(resendRow).toBeDefined();
    expect(resendRow?.actor).toBe(ADMIN_EMAIL);
    expect(resendRow?.after_summary).toContain("outcome=sent");
    expect(resendRow?.after_summary).not.toContain("guardian@example.com");
    expect(resendRow?.after_summary).not.toContain("Omar");
  });

  it("a throttled admin resend still writes an admin_fallback audit row (outcome=rate_limited)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert(
        "members",
        memberRow("minor3@example.com", {
          name: "Lina Yousef",
          member_lane: "minor",
          lifecycle_state: "pending_guardian",
          guardian_consent_state: "pending",
        }),
      ),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("guardianConsents", {
        member_id: memberId,
        guardian_name: "Omar Yousef",
        guardian_email: "guardian3@example.com",
        confirmation_state: "pending" as const,
        confirmation_token_hash: "hash0",
        token_sent_at: Date.now() - 1000,
        timestamp: Date.now(),
      }),
    );
    // First succeeds, second is throttled (per-hour limit 1).
    await asAdmin.action(api.guardians.resendGuardianEmailFromPanel, { memberId });
    const second = await asAdmin.action(api.guardians.resendGuardianEmailFromPanel, {
      memberId,
    });
    expect(second).toEqual({ ok: false, error: "rate_limited" });
    const page = await asAdmin.query(api.admin.audit.listAdminAuditLog, {});
    const rows = page.rows.filter(
      (r) => r.action === "resendGuardianEmailFromPanel",
    );
    // Both the sent and the throttled attempt are attributed to the admin.
    expect(rows.some((r) => r.after_summary?.includes("outcome=sent"))).toBe(true);
    expect(rows.some((r) => r.after_summary?.includes("outcome=rate_limited"))).toBe(
      true,
    );
  });

  it("a member's OWN resend produces no admin_fallback rows", async () => {
    const t = convexTest(schema, modules);
    const asMinor = await signIn(t, "minorself@example.com", {
      name: "Lina Yousef",
      member_lane: "minor",
      lifecycle_state: "pending_guardian",
      guardian_consent_state: "pending",
    });
    const member = await t.run(async (ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_email", (q) => q.eq("email", "minorself@example.com"))
        .unique(),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("guardianConsents", {
        member_id: member!._id,
        guardian_name: "Omar Yousef",
        guardian_email: "guardian4@example.com",
        confirmation_state: "pending" as const,
        confirmation_token_hash: "hash0",
        token_sent_at: Date.now() - 1000,
        timestamp: Date.now(),
      }),
    );
    const res = await asMinor.action(api.guardians.resendGuardianEmail, {});
    expect(res).toEqual({ ok: true });
    // No admin_fallback rows from the member-initiated path.
    const adminRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .withIndex("by_source_time", (q) => q.eq("source", "admin_fallback"))
        .collect(),
    );
    expect(adminRows).toHaveLength(0);
  });

  it("a non-admin cannot resend from the panel (neutral envelope, not a throw)", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("someone@example.com")),
    );
    expect(
      await asMember.action(api.guardians.resendGuardianEmailFromPanel, { memberId }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(sentEmails).toHaveLength(0);
  });

  it("admin resends hit the SAME per-member throttle; a throttled resend does not rotate the token", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert(
        "members",
        memberRow("minor2@example.com", {
          name: "Lina Yousef",
          member_lane: "minor",
          lifecycle_state: "pending_guardian",
          guardian_consent_state: "pending",
        }),
      ),
    );
    const consentId = await t.run(async (ctx) =>
      ctx.db.insert("guardianConsents", {
        member_id: memberId,
        guardian_name: "Omar Yousef",
        guardian_email: "guardian2@example.com",
        confirmation_state: "pending" as const,
        confirmation_token_hash: "hash0",
        token_sent_at: Date.now() - 1000,
        timestamp: Date.now(),
      }),
    );

    // First admin resend succeeds and rotates the token (per-hour limit is 1).
    const first = await asAdmin.action(api.guardians.resendGuardianEmailFromPanel, {
      memberId,
    });
    expect(first).toEqual({ ok: true });
    const afterFirst = await t.run(async (ctx) => ctx.db.get(consentId));
    const hashAfterFirst = afterFirst?.confirmation_token_hash;
    expect(hashAfterFirst).not.toBe("hash0");

    // Second admin resend within the hour is refused by the SAME per-member
    // bucket the member's own resend uses (the bypass this blocker closed)...
    const second = await asAdmin.action(api.guardians.resendGuardianEmailFromPanel, {
      memberId,
    });
    expect(second).toEqual({ ok: false, error: "rate_limited" });
    // ...and the refused resend did NOT rotate the token.
    const afterSecond = await t.run(async (ctx) => ctx.db.get(consentId));
    expect(afterSecond?.confirmation_token_hash).toBe(hashAfterFirst);
    // Only one email actually went out.
    expect(sentEmails).toHaveLength(1);
  });
});

describe("data requests", () => {
  it("submitDataRequest for someone else's email creates ONLY a record, no member side-effect", async () => {
    const t = convexTest(schema, modules);
    // Turnstile passes at the fetch level (same mock the join tests use).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: true }))),
    );
    // A real member exists with this email; a visitor submits an erasure for it.
    const victimId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("victim@example.com")),
    );
    const before = await t.run(async (ctx) => ctx.db.get(victimId));

    const res = await t.action(api.admin.dataRequests.submitDataRequest, {
      subject_email: "victim@example.com",
      kind: "erasure",
      turnstileToken: "any",
    });
    expect(res).toMatchObject({ ok: true, state: "submitted" });

    // The member row is UNCHANGED: submitting is not approving (§8 negative test).
    const after = await t.run(async (ctx) => ctx.db.get(victimId));
    expect(after).toEqual(before);

    // The request is linked (server-side lookup) but inert.
    const requests = await t.run(async (ctx) =>
      ctx.db.query("dataRequests").collect(),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].state).toBe("submitted");
    expect(requests[0].linked_member_id).toBe(victimId);
  });

  it("submitDataRequest with a failed Turnstile writes nothing (no record, no rate-limit)", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false }))),
    );
    const res = await t.action(api.admin.dataRequests.submitDataRequest, {
      subject_email: "someone@example.com",
      kind: "export",
      turnstileToken: "bad",
    });
    expect(res).toEqual({ ok: false, error: "validation" });
    const requests = await t.run(async (ctx) => ctx.db.query("dataRequests").collect());
    expect(requests).toHaveLength(0);
    const limits = await t.run(async (ctx) => ctx.db.query("rateLimits").collect());
    expect(limits).toHaveLength(0);
  });

  it("an admin lists and approves a data request with a verification note + audit", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const requestId = await t.run(async (ctx) =>
      ctx.db.insert("dataRequests", {
        subject_email: "subject@example.com",
        kind: "export",
        state: "submitted",
        created_at: Date.now(),
      }),
    );
    const list = await asAdmin.query(api.admin.dataRequests.listDataRequests, {});
    expect(list).toHaveLength(1);
    expect(list[0].requestId).toBe(requestId);

    const res = await asAdmin.mutation(api.admin.dataRequests.approveDataRequest, {
      requestId,
      decision: "approved",
      verification_method: "matched signed-in session",
    });
    expect(res).toEqual({ ok: true, state: "approved" });

    const req = await t.run(async (ctx) => ctx.db.get(requestId));
    expect(req?.state).toBe("approved");
    expect(req?.approver).toBe(ADMIN_EMAIL);
    expect(req?.verification_method).toBe("matched signed-in session");

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "approveDataRequest"))
        .collect(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].source).toBe("admin_fallback");
  });

  it("approveDataRequest requires a non-empty verification note", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const requestId = await t.run(async (ctx) =>
      ctx.db.insert("dataRequests", {
        subject_email: "subject@example.com",
        kind: "export",
        state: "submitted",
        created_at: Date.now(),
      }),
    );
    const res = await asAdmin.mutation(api.admin.dataRequests.approveDataRequest, {
      requestId,
      decision: "approved",
      verification_method: "   ",
    });
    expect(res).toEqual({ ok: false, error: "validation" });
  });

  it("a non-admin approving a data request gets a neutral not_authorized, no state change", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    const requestId = await t.run(async (ctx) =>
      ctx.db.insert("dataRequests", {
        subject_email: "subject@example.com",
        kind: "erasure",
        state: "submitted",
        created_at: Date.now(),
      }),
    );
    const res = await asMember.mutation(api.admin.dataRequests.approveDataRequest, {
      requestId,
      decision: "approved",
      verification_method: "trying to sneak in",
    });
    expect(res).toEqual({ ok: false, error: "not_authorized" });
    const req = await t.run(async (ctx) => ctx.db.get(requestId));
    expect(req?.state).toBe("submitted");
  });

  it("a signed-in member requests HER OWN data; email is from the session, not an arg", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, "myself@example.com");
    const res = await asMember.mutation(
      api.admin.dataRequests.submitMyDataRequest,
      { kind: "export" },
    );
    expect(res).toMatchObject({ ok: true, state: "submitted" });
    const requests = await t.run(async (ctx) => ctx.db.query("dataRequests").collect());
    expect(requests).toHaveLength(1);
    expect(requests[0].subject_email).toBe("myself@example.com");
  });

  it("submitMyDataRequest succeeds for a pending_guardian minor (rights in every state)", async () => {
    const t = convexTest(schema, modules);
    const asMinor = await signIn(t, "waitingminor@example.com", {
      member_lane: "minor",
      lifecycle_state: "pending_guardian",
      guardian_consent_state: "pending",
    });
    const res = await asMinor.mutation(
      api.admin.dataRequests.submitMyDataRequest,
      { kind: "erasure" },
    );
    expect(res).toMatchObject({ ok: true, state: "submitted" });
    const requests = await t.run(async (ctx) => ctx.db.query("dataRequests").collect());
    expect(requests).toHaveLength(1);
    expect(requests[0].subject_email).toBe("waitingminor@example.com");
    expect(requests[0].kind).toBe("erasure");
  });

  it("submitMyDataRequest succeeds for an active minor and a restricted_unknown member", async () => {
    const t = convexTest(schema, modules);
    const asActiveMinor = await signIn(t, "activeminor@example.com", {
      member_lane: "minor",
      lifecycle_state: "active",
    });
    expect(
      await asActiveMinor.mutation(api.admin.dataRequests.submitMyDataRequest, {
        kind: "export",
      }),
    ).toMatchObject({ ok: true, state: "submitted" });

    const asUnknown = await signIn(t, "unknown@example.com", {
      member_lane: "restricted_unknown",
      lifecycle_state: "pending_review",
    });
    expect(
      await asUnknown.mutation(api.admin.dataRequests.submitMyDataRequest, {
        kind: "export",
      }),
    ).toMatchObject({ ok: true, state: "submitted" });
  });
});

describe("audit log visibility", () => {
  it("lists only admin_fallback rows for an admin", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    await t.run(async (ctx) => {
      await ctx.db.insert("auditLog", {
        actor: ADMIN_EMAIL,
        role: "admin_fallback",
        action: "approveDataRequest",
        target_id: "req1",
        after_summary: "dataRequest approved kind=export",
        timestamp: Date.now(),
        source: "admin_fallback",
      });
      await ctx.db.insert("auditLog", {
        actor: "someone@example.com",
        role: "member",
        action: "writeConsent",
        target_id: "m1",
        after_summary: "marketing=true",
        timestamp: Date.now(),
        source: "member",
      });
    });
    const page = await asAdmin.query(api.admin.audit.listAdminAuditLog, {});
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].action).toBe("approveDataRequest");
  });

  it("admin rows OLDER than a full page of member rows are still reachable", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    // One old admin row, then a whole page-worth (>25) of NEWER member rows.
    await t.run(async (ctx) => {
      await ctx.db.insert("auditLog", {
        actor: ADMIN_EMAIL,
        role: "admin_fallback",
        action: "resolveConflictAsClaimed",
        target_id: "old_admin_row",
        after_summary: "claim_state=unclaimed",
        timestamp: 1000,
        source: "admin_fallback",
      });
      for (let i = 0; i < 40; i++) {
        await ctx.db.insert("auditLog", {
          actor: "member@example.com",
          role: "member",
          action: "writeConsent",
          target_id: `m${i}`,
          after_summary: "marketing=true",
          timestamp: 100000 + i,
          source: "member",
        });
      }
    });
    // With in-memory filtering after a generic-page fetch, the first page would
    // be all member rows and the admin row would be invisible. The by_source
    // index makes the admin row reachable on the first page.
    const page = await asAdmin.query(api.admin.audit.listAdminAuditLog, {});
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].target_id).toBe("old_admin_row");
  });
});
