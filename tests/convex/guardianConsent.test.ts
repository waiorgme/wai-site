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
let failNextSend = false;
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (args: { to: string[]; subject: string; text: string }) => {
        if (failNextSend) {
          failNextSend = false;
          return { error: { message: "boom" } };
        }
        sentEmails.push(args);
        return { error: null };
      },
    };
  },
}));

process.env.AUTH_RESEND_KEY = "test-key";
// The deployment's public origin: guardian links must be built from it
// (never a hard-coded domain), same env the auth magic links use.
process.env.SITE_URL = "http://localhost:4321";

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
  failNextSend = false;
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
    // The vault draft's own sentences, verbatim.
    expect(email.text).toContain(
      "To give your consent, please click below. If you'd prefer not to, simply ignore this email and the account won't be activated.",
    );
    expect(email.text).toContain(
      "You can read how we protect young members here:",
    );
    expect(email.text).toContain("and how we handle data here:");
    expect(email.text).toContain("/safeguarding/");
    expect(email.text).toContain("/privacy/");
    expect(email.text).toContain("support@waiorg.me");
    // The confirm link targets THIS deployment's configured origin, so a
    // staging token can never send a guardian to the production domain.
    expect(email.text).toContain(
      "http://localhost:4321/guardian-confirm/?token=",
    );
    expect(email.text).not.toContain("waiorg.me/guardian-confirm");
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

  it("fails closed when SITE_URL is not configured: no email, audited refusal", async () => {
    const prev = process.env.SITE_URL;
    delete process.env.SITE_URL;
    try {
      const t = convexTest(schema, modules);
      const memberId = await seedPendingMinor(t);
      await t.action(internal.guardians.sendGuardianEmail, { memberId });
      expect(sentEmails).toHaveLength(0);
      const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
      expect(
        audits.filter(
          (a) =>
            a.action === "sendGuardianEmail.refused" &&
            (a.after_summary ?? "").includes("SITE_URL"),
        ),
      ).toHaveLength(1);
    } finally {
      process.env.SITE_URL = prev;
    }
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

    // The consent PROOF the vault requires: action, when, which policy.
    const proof = await t.run(async (ctx) => ctx.db.query("guardianConsents").first());
    expect(proof?.confirmation_state).toBe("confirmed");
    expect(proof?.confirmed_at).toBeDefined();
    expect(proof?.policy_version).toBe("2026-07-02");

    // A used token is NEUTRAL at lookup (no enumeration): same reply as an
    // unknown token. The friendly already-done exists only on the mutation.
    expect(await t.query(api.guardians.lookupGuardianToken, { token })).toEqual({
      state: "invalid",
    });

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

    // §8: expiring a minor's consent window leaves audit evidence, PII-free.
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    const expiryAudit = audits.filter(
      (a) => a.action === "captureGuardianConsent.expired",
    );
    expect(expiryAudit).toHaveLength(1);
    expect(expiryAudit[0].after_summary ?? "").not.toContain("Mona");
    expect(expiryAudit[0].after_summary ?? "").not.toContain("guardian@example.com");
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
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    const firstToken = tokenFromEmail(sentEmails[0]);

    // The resend is an ACTION: ok means Resend actually accepted the email.
    const signedIn = await asMinor(t, memberId);
    const first = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(first).toEqual({ ok: true });
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
    const second = await signedIn.action(api.guardians.resendGuardianEmail, {});
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
    const result = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(result).toEqual({ ok: false, error: "not_eligible" });
  });

  it("global daily cap: refused, audited, nothing rotated, no throttle burned", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    const liveToken = tokenFromEmail(sentEmails[0]);
    // Spend the rest of the day's global budget (shared with magic links).
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", "signin24h:global"))
        .unique();
      await ctx.db.patch(row!._id, { count: 90 });
    });
    const signedIn = await asMinor(t, memberId);
    const result = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(sentEmails).toHaveLength(1);
    // The emailed link is untouched and still works.
    expect(
      (await t.query(api.guardians.lookupGuardianToken, { token: liveToken })).state,
    ).toBe("confirmable");
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(
      audits.filter(
        (a) =>
          a.action === "sendGuardianEmail.refused" &&
          (a.after_summary ?? "").includes("global"),
      ),
    ).toHaveLength(1);
  });

  it("a failed resend never resurrects an EXPIRED row as pending", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    await t.run(async (ctx) => {
      const consent = await ctx.db.query("guardianConsents").first();
      await ctx.db.patch(consent!._id, { confirmation_state: "expired" });
    });

    failNextSend = true;
    const signedIn = await asMinor(t, memberId);
    const result = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(result).toEqual({ ok: false, error: "send_failed" });

    const consent = await t.run(async (ctx) => ctx.db.query("guardianConsents").first());
    expect(consent?.confirmation_state).toBe("expired");
  });

  it("a failed resend releases the member's quota: the immediate retry succeeds", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });

    failNextSend = true;
    const signedIn = await asMinor(t, memberId);
    const failed = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(failed).toEqual({ ok: false, error: "send_failed" });

    // The 1/hour bucket was given back, so the retry goes straight through.
    const retry = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(retry).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(2);
  });

  it("a global-cap refusal never burns the member's own quota", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", "signin24h:global"))
        .unique();
      await ctx.db.patch(row!._id, { count: 90 });
    });
    const signedIn = await asMinor(t, memberId);
    const refused = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(refused).toEqual({ ok: false, error: "rate_limited" });

    // Budget frees up (a new day, operationally): her hourly quota is intact.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", "signin24h:global"))
        .unique();
      await ctx.db.patch(row!._id, { count: 1 });
    });
    const retry = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(retry).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(2);
  });

  it("failure loops are bounded: the 6th failed attempt in a day is refused", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    const signedIn = await asMinor(t, memberId);

    for (let i = 0; i < 5; i++) {
      failNextSend = true;
      const result = await signedIn.action(api.guardians.resendGuardianEmail, {});
      expect(result).toEqual({ ok: false, error: "send_failed" });
    }
    // The failure bucket (5/day) is exhausted; even though the resend quota
    // was released each time, the loop stops here.
    failNextSend = true;
    const sixth = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(sixth).toEqual({ ok: false, error: "rate_limited" });
    expect(sentEmails).toHaveLength(1); // only the original hook send
  });

  it("global budget counts DELIVERED sends only: a failed send releases it", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    const before = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", "signin24h:global"))
        .unique();
      return row?.count;
    });

    failNextSend = true;
    const signedIn = await asMinor(t, memberId);
    await signedIn.action(api.guardians.resendGuardianEmail, {});

    const after = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", "signin24h:global"))
        .unique();
      return row?.count;
    });
    expect(after).toBe(before);
  });

  it("Resend failure: previous token restored, failure audited, member told the truth", async () => {
    const t = convexTest(schema, modules);
    const memberId = await seedPendingMinor(t);
    await t.action(internal.guardians.sendGuardianEmail, { memberId });
    const liveToken = tokenFromEmail(sentEmails[0]);

    failNextSend = true;
    const signedIn = await asMinor(t, memberId);
    const result = await signedIn.action(api.guardians.resendGuardianEmail, {});
    expect(result).toEqual({ ok: false, error: "send_failed" });
    expect(sentEmails).toHaveLength(1); // nothing delivered

    // The link that WAS emailed still works: the rollback restored its hash.
    expect(
      (await t.query(api.guardians.lookupGuardianToken, { token: liveToken })).state,
    ).toBe("confirmable");
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(
      audits.filter((a) => a.action === "sendGuardianEmail.failed"),
    ).toHaveLength(1);
  });
});
