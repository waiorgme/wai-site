import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  GUARDIAN_TOKEN_TTL_MS,
  hashGuardianToken,
} from "../../convex/lib/guardianToken";
import schema from "../../convex/schema";

// The guardian-consent flow end to end: the vault's confirmation email goes
// out when a 13-17 member reaches pending_guardian, and ONLY an explicit
// button press on a live token activates her (Under-18 decision: a real
// confirmation step). Resend is the only thing mocked.

const modules = import.meta.glob("../../convex/**/*.*s");

const sentEmails: Array<{ to: string[]; subject: string; text: string }> = [];
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (args: { to: string[]; subject: string; text: string }) => {
        sentEmails.push(args);
        return { error: null };
      },
    };
  },
}));

process.env.AUTH_RESEND_KEY = "test-key";

const MINOR_DOB = "2011-01-15"; // 15 in 2026

// A 13-17 member exactly as the join flow leaves her after email
// verification: pending_guardian, with the guardian row captured at join.
const seedPendingMinor = async (t: ReturnType<typeof convexTest>) => {
  const memberId = await t.run(async (ctx) =>
    ctx.db.insert("members", {
      email: "teen@example.com",
      name: "Layla Haddad",
      source: "new_signup",
      lifecycle_state: "pending_guardian",
      date_of_birth: MINOR_DOB,
      date_of_birth_source: "self_declared",
      age_confidence: "declared",
      minor_until: "2029-01-15",
      guardian_consent_state: "pending",
      gender: "female",
      career_stage_answer: "Studying / cadet",
      member_lane: "minor",
      created_at: Date.now(),
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("guardianConsents", {
      member_id: memberId,
      guardian_name: "Mona Haddad",
      guardian_email: "guardian@example.com",
      confirmation_state: "pending",
      confirmation_token_hash: "placeholder-from-join",
      timestamp: Date.now(),
    });
  });
  return memberId;
};

const tokenFromEmail = (email: { text: string }): string => {
  const m = /guardian-confirm\/\?token=([0-9a-f]+)/.exec(email.text);
  if (m === null) {
    throw new Error("No confirm link in the guardian email");
  }
  return m[1];
};

afterEach(() => {
  sentEmails.length = 0;
  vi.unstubAllGlobals();
});

describe("sending the guardian email", () => {
  it("sends the vault email verbatim shape: subject, protections list, tokened button link", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });

    expect(sentEmails).toHaveLength(1);
    const email = sentEmails[0];
    expect(email.to).toEqual(["guardian@example.com"]);
    expect(email.subject).toBe(
      "Please confirm, your child would like to join Women in Aviation Middle East",
    );
    expect(email.text).toContain("Dear Mona Haddad,");
    expect(email.text).toContain("Layla has asked to join");
    expect(email.text).toContain("never share a young member's details");
    expect(email.text).toContain("/safeguarding/");
    expect(email.text).toContain("/privacy/");
    expect(email.text).toContain("support@waiorg.me");
    expect(email.text).not.toContain("—"); // no em dashes
    const token = tokenFromEmail(email);
    // Only the HASH is stored, never the token.
    const consent = await t.run(async (ctx) =>
      ctx.db.query("guardianConsents").first(),
    );
    expect(consent?.confirmation_token_hash).toBe(await hashGuardianToken(token));
    expect(consent?.confirmation_token_hash).not.toBe(token);
    expect(consent?.token_sent_at).toBeDefined();
  });

  it("does not send for ineligible members (active, adult, or already confirmed)", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(memberId, { lifecycle_state: "active" });
    });
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    expect(sentEmails).toHaveLength(0);
  });
});

describe("confirming", () => {
  it("happy path: lookup shows confirmable, the button press activates her, cert issued, audited", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    const token = tokenFromEmail(sentEmails[0]);

    const looked = await t.query(api.guardians.lookupGuardianToken, { token });
    expect(looked).toEqual({ state: "confirmable", applicantFirstName: "Layla" });

    // Lookup alone must confirm NOTHING (mail-scanner safety).
    let member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.lifecycle_state).toBe("pending_guardian");

    const result = await t.mutation(api.guardians.confirmGuardianConsent, { token });
    expect(result).toEqual({ state: "confirmed" });

    member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.lifecycle_state).toBe("active");
    expect(member?.guardian_consent_state).toBe("confirmed");
    expect(member?.date_of_birth_source).toBe("guardian_confirmed");
    expect(member?.age_confidence).toBe("confirmed");

    const certs = await t.run(async (ctx) => ctx.db.query("certificates").collect());
    expect(certs).toHaveLength(1);
    expect(certs[0].member_id).toBe(memberId);

    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    const confirmAudit = audits.filter((a) => a.action === "confirmGuardianConsent");
    expect(confirmAudit).toHaveLength(1);
    // No guardian PII in audit summaries.
    for (const a of audits) {
      expect(a.after_summary ?? "").not.toContain("Mona");
      expect(a.after_summary ?? "").not.toContain("guardian@example.com");
    }
  });

  it("is idempotent: a second press says already done and issues nothing new", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    const token = tokenFromEmail(sentEmails[0]);
    await t.mutation(api.guardians.confirmGuardianConsent, { token });
    const again = await t.mutation(api.guardians.confirmGuardianConsent, { token });
    expect(again).toEqual({ state: "already_confirmed" });
    expect(
      await t.run(async (ctx) => ctx.db.query("certificates").collect()),
    ).toHaveLength(1);
  });

  it("an unknown token is neutral: invalid, no member data, nothing changes", async () => {
    const t = convexTest(schema, modules);
    await seedPendingMinor(t);
    const looked = await t.query(api.guardians.lookupGuardianToken, {
      token: "f".repeat(32),
    });
    expect(looked).toEqual({ state: "invalid" });
    const result = await t.mutation(api.guardians.confirmGuardianConsent, {
      token: "f".repeat(32),
    });
    expect(result).toEqual({ state: "invalid" });
  });

  it("expires after 30 days: lookup and confirm both refuse, row marked expired", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    const token = tokenFromEmail(sentEmails[0]);
    await t.run(async (ctx) => {
      const consent = await ctx.db.query("guardianConsents").first();
      await ctx.db.patch(consent!._id, {
        token_sent_at: Date.now() - GUARDIAN_TOKEN_TTL_MS - 1000,
      });
    });
    expect(await t.query(api.guardians.lookupGuardianToken, { token })).toEqual({
      state: "invalid",
    });
    expect(
      await t.mutation(api.guardians.confirmGuardianConsent, { token }),
    ).toEqual({ state: "invalid" });
    const consent = await t.run(async (ctx) => ctx.db.query("guardianConsents").first());
    expect(consent?.confirmation_state).toBe("expired");
    const member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.lifecycle_state).toBe("pending_guardian");
  });
});

describe("resending", () => {
  const asMinor = async (t: ReturnType<typeof convexTest>, memberId: string) => {
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "teen@example.com" }),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(memberId as never, { userId });
    });
    return t.withIdentity({ subject: `${userId}|testsession` });
  };

  it("rotates the token (old link dies) and throttles to 1 per hour", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    const firstToken = tokenFromEmail(sentEmails[0]);

    const signedIn = await asMinor(t, memberId);
    const first = await signedIn.mutation(api.guardians.resendGuardianEmail, {});
    expect(first).toEqual({ ok: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(sentEmails).toHaveLength(2);
    const secondToken = tokenFromEmail(sentEmails[1]);
    expect(secondToken).not.toBe(firstToken);

    // The rotated-away token is dead.
    expect(
      await t.query(api.guardians.lookupGuardianToken, { token: firstToken }),
    ).toEqual({ state: "invalid" });
    // The fresh one works.
    expect(
      (await t.query(api.guardians.lookupGuardianToken, { token: secondToken }))
        .state,
    ).toBe("confirmable");

    // Second resend inside the hour: throttled, audited, no email.
    const second = await signedIn.mutation(api.guardians.resendGuardianEmail, {});
    expect(second).toEqual({ ok: false, error: "rate_limited" });
    expect(sentEmails).toHaveLength(2);
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(
      audits.filter((a) => a.action === "resendGuardianEmail.refused"),
    ).toHaveLength(1);
  });

  it("refuses members who are not pending_guardian minors", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(memberId, { lifecycle_state: "active" });
    });
    const signedIn = await asMinor(t, memberId);
    const result = await signedIn.mutation(api.guardians.resendGuardianEmail, {});
    expect(result).toEqual({ ok: false, error: "not_eligible" });
  });
});
