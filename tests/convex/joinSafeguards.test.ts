import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// SEC-5 + 13+ regressions (Codex Gate 4 blockers): the public join path must
// honour the same safeguarding rules as the settings path. A minor who ticks
// the pipeline box gets an explicit FALSE consent row plus an audited refusal,
// and an under-13 DOB is rejected before any member or consent row exists
// (vault: 01 Under-18 Members & Mentorship Safeguards, minimum joining age 13).

const modules = import.meta.glob("../../convex/**/*.*s");

// Fixed reference day for DOB maths: tests run "today", so pick DOBs far from
// today's boundaries (the pure boundary cases live in tests/unit/age.test.ts).
const MINOR_DOB = "2011-01-15"; // 15 years old in 2026
const ADULT_DOB = "1990-01-15";
const UNDER_13_DOB = "2016-01-15"; // 10 years old in 2026

const joinArgs = (email: string, dob: string, pipeline: boolean) => ({
  name: "Test Member",
  email,
  careerStageAnswer: "student",
  genderAnswer: "female" as const,
  dobAnswer: dob,
  consents: { terms: true, marketing: false, pipeline },
});

describe("join-path pipeline consent guard (SEC-5)", () => {
  it("a minor's ticked pipeline box becomes an explicit false row with an audited refusal", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.members.createPendingMember,
      joinArgs("minor@example.com", MINOR_DOB, true),
    );
    expect(result.ok).toBe(true);

    const consents = await t.run(async (ctx) =>
      ctx.db.query("consentRecords").collect(),
    );
    const pipeline = consents.filter((c) => c.type === "pipeline");
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0].value).toBe(false);

    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    const refusal = audits.filter((a) => a.action === "writeConsent.refused");
    expect(refusal).toHaveLength(1);
    expect(refusal[0].after_summary).toContain("lane=minor");
  });

  it("an adult male (ally lane) cannot consent into the women-only pipeline at join", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.members.createPendingMember, {
      ...joinArgs("ally@example.com", ADULT_DOB, true),
      genderAnswer: "male" as const,
    });

    const consents = await t.run(async (ctx) =>
      ctx.db.query("consentRecords").collect(),
    );
    const pipeline = consents.filter((c) => c.type === "pipeline");
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0].value).toBe(false);

    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    const refusal = audits.filter((a) => a.action === "writeConsent.refused");
    expect(refusal).toHaveLength(1);
    expect(refusal[0].after_summary).toContain("lane=ally");
  });

  it("writeConsent refuses pipeline=true for the ally lane, audited, no row", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "ally@example.com" }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        email: "ally@example.com",
        name: "Test Ally",
        source: "new_signup",
        lifecycle_state: "active",
        date_of_birth: ADULT_DOB,
        date_of_birth_source: "self_declared",
        age_confidence: "declared",
        guardian_consent_state: "not_required",
        gender: "male",
        career_stage_answer: "established",
        member_lane: "ally",
        created_at: Date.now(),
        userId,
      });
    });

    const asAlly = t.withIdentity({ subject: `${userId}|testsession` });
    const result = await asAlly.mutation(api.members.writeConsent, {
      type: "pipeline",
      value: true,
    });
    expect(result).toEqual({ ok: false, error: "not_permitted" });

    const consents = await t.run(async (ctx) =>
      ctx.db.query("consentRecords").collect(),
    );
    expect(consents).toHaveLength(0);
    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    expect(
      audits.filter((a) => a.action === "writeConsent.refused"),
    ).toHaveLength(1);
  });

  it("an adult's ticked (attested) pipeline box is stored as true, and the review opens at activation", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(
      internal.members.createPendingMember,
      joinArgs("adult@example.com", ADULT_DOB, true),
    );

    const consents = await t.run(async (ctx) =>
      ctx.db.query("consentRecords").collect(),
    );
    const pipeline = consents.filter((c) => c.type === "pipeline");
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0].value).toBe(true);

    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    expect(
      audits.filter((a) => a.action === "writeConsent.refused"),
    ).toHaveLength(0);

    // The pipeline invariant (optin-toggles spec): the join capture is only
    // half the story; when the member activates, the eligibility review
    // opens, so no true consent is ever actionable without attestation AND
    // review. (Activation runs in the auth hook; exercised here directly.)
    await t.run(async (ctx) => {
      const member = await ctx.db.query("members").first();
      await ctx.db.patch(member!._id, { lifecycle_state: "active" });
      const activated = await ctx.db.get(member!._id);
      const { ensurePipelineReviewOnActivation } = await import(
        "../../convex/lib/pipeline"
      );
      await ensurePipelineReviewOnActivation(ctx, activated!);
    });
    const reviews = await t.run(async (ctx) =>
      ctx.db.query("pipelineEligibilityReviews").collect(),
    );
    expect(reviews).toHaveLength(1);
  });
});

// Drives the real submitJoin action with Turnstile mocked at the fetch level:
// pass = the Cloudflare verify endpoint says success, fail = it says no.
const TURNSTILE_ENV = { TURNSTILE_SECRET_KEY: "test-secret" };
const stubTurnstile = (success: boolean) => {
  process.env.TURNSTILE_SECRET_KEY = TURNSTILE_ENV.TURNSTILE_SECRET_KEY;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success }))),
  );
};

const submitArgs = (email: string, extra: Record<string, unknown> = {}) => ({
  firstName: "Sara",
  lastName: "Ahmed",
  email,
  country: "United Arab Emirates",
  lookingFor: [],
  careerStageAnswer: "Studying / cadet",
  genderAnswer: "female" as const,
  dobAnswer: ADULT_DOB,
  attestation: true,
  consents: { terms: true, marketing: false, pipeline: false },
  turnstileToken: "token",
  ...extra,
});

const allRows = async (
  t: ReturnType<typeof convexTest>,
): Promise<{ members: number; consents: number; rateLimits: number }> =>
  t.run(async (ctx) => ({
    members: (await ctx.db.query("members").collect()).length,
    consents: (await ctx.db.query("consentRecords").collect()).length,
    rateLimits: (await ctx.db.query("rateLimits").collect()).length,
  }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitJoin bot hardening (Turnstile before any stored state)", () => {
  it("a failed Turnstile leaves NOTHING behind: no member, consent, or rate-limit row", async () => {
    const t = convexTest(schema, modules);
    stubTurnstile(false);
    const result = await t.action(
      api.members.submitJoin,
      submitArgs("victim@example.com"),
    );
    expect(result).toEqual({ ok: false, error: "validation" });
    expect(await allRows(t)).toEqual({ members: 0, consents: 0, rateLimits: 0 });
  });

  it("a filled honeypot is silently dropped with no side effects", async () => {
    const t = convexTest(schema, modules);
    stubTurnstile(true);
    const result = await t.action(
      api.members.submitJoin,
      submitArgs("bot@example.com", { website: "https://spam.example" }),
    );
    expect(result).toEqual({ ok: true, already: true, route: "sign_in" });
    expect(await allRows(t)).toEqual({ members: 0, consents: 0, rateLimits: 0 });
  });

  it("per-email join cap: the 6th human-verified attempt in a day is refused", async () => {
    const t = convexTest(schema, modules);
    stubTurnstile(true);
    for (let i = 0; i < 5; i++) {
      const r = await t.action(
        api.members.submitJoin,
        submitArgs("repeat@example.com"),
      );
      expect(r.ok).toBe(true); // 1st creates, the rest route to sign-in
    }
    const sixth = await t.action(
      api.members.submitJoin,
      submitArgs("repeat@example.com"),
    );
    expect(sixth).toEqual({ ok: false, error: "rate_limited" });
  });

  it("global join cap: once 300 joins are consumed in a day, a fresh email is refused", async () => {
    const t = convexTest(schema, modules);
    stubTurnstile(true);
    // One real join creates the global bucket, then the day's budget is spent
    // (seeded directly; 300 live submits would exercise the same window 300x).
    await t.action(api.members.submitJoin, submitArgs("first@example.com"));
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", "join24h:global"))
        .unique();
      if (row === null) {
        throw new Error("global join bucket missing");
      }
      await ctx.db.patch(row._id, { count: 300 });
    });
    const refused = await t.action(
      api.members.submitJoin,
      submitArgs("someone-new@example.com"),
    );
    expect(refused).toEqual({ ok: false, error: "rate_limited" });
    expect((await allRows(t)).members).toBe(1);
  });

  it("an out-of-list career stage is rejected server-side, nothing stored", async () => {
    const t = convexTest(schema, modules);
    stubTurnstile(true);
    const result = await t.action(
      api.members.submitJoin,
      submitArgs("stage@example.com", { careerStageAnswer: "student" }),
    );
    expect(result).toEqual({ ok: false, error: "validation" });
    expect((await allRows(t)).members).toBe(0);
  });
});

describe("13-17 guardian branch", () => {
  it("a minor join records the guardian (pending) plus its own audit row", async () => {
    const t = convexTest(schema, modules);
    stubTurnstile(true);
    const result = await t.action(
      api.members.submitJoin,
      submitArgs("teen@example.com", {
        dobAnswer: MINOR_DOB,
        guardianName: "Mona Al-Sayegh",
        guardianEmail: "guardian@example.com",
      }),
    );
    expect(result.ok).toBe(true);

    const guardians = await t.run(async (ctx) =>
      ctx.db.query("guardianConsents").collect(),
    );
    expect(guardians).toHaveLength(1);
    expect(guardians[0].confirmation_state).toBe("pending");

    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    const capture = audits.filter((a) => a.action === "captureGuardianConsent");
    expect(capture).toHaveLength(1);
    expect(capture[0].after_summary).not.toContain("Mona");
    expect(capture[0].after_summary).not.toContain("guardian@example.com");
  });
});

describe("pending_guardian lockout (unusable until guardian confirms)", () => {
  const pendingMinor = async (t: ReturnType<typeof convexTest>) => {
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "minor@example.com" }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        email: "minor@example.com",
        name: "Test Minor",
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
        userId,
      });
    });
    return t.withIdentity({ subject: `${userId}|testsession` });
  };

  it("updateProfile is refused before guardian confirmation", async () => {
    const t = convexTest(schema, modules);
    const asMinor = await pendingMinor(t);
    const result = await asMinor.mutation(api.members.updateProfile, {
      headline: "Future pilot",
    });
    expect(result).toEqual({ ok: false, error: "not_active" });
  });

  it("photo upload URLs are refused before guardian confirmation", async () => {
    const t = convexTest(schema, modules);
    const asMinor = await pendingMinor(t);
    await expect(
      asMinor.mutation(api.members.generatePhotoUploadUrl, {}),
    ).rejects.toThrow(/not active/i);
  });

  it("consent changes are refused before guardian confirmation", async () => {
    const t = convexTest(schema, modules);
    const asMinor = await pendingMinor(t);
    const result = await asMinor.mutation(api.members.writeConsent, {
      type: "marketing",
      value: true,
    });
    expect(result).toEqual({ ok: false, error: "not_active" });
    const consents = await t.run(async (ctx) =>
      ctx.db.query("consentRecords").collect(),
    );
    expect(consents).toHaveLength(0);
  });
});

describe("SAFE-1: active minors cannot re-add mentorship via profile edit", () => {
  it("mentorship looking-for values are stripped server-side for the minor lane", async () => {
    const t = convexTest(schema, modules);
    // A guardian-confirmed minor: lane stays minor, lifecycle is active.
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "activeminor@example.com" }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        email: "activeminor@example.com",
        name: "Active Minor",
        source: "new_signup",
        lifecycle_state: "active",
        date_of_birth: MINOR_DOB,
        date_of_birth_source: "guardian_confirmed",
        age_confidence: "confirmed",
        minor_until: "2029-01-15",
        guardian_consent_state: "confirmed",
        gender: "female",
        career_stage_answer: "Studying / cadet",
        member_lane: "minor",
        created_at: Date.now(),
        userId,
      });
    });
    const asMinor = t.withIdentity({ subject: `${userId}|testsession` });
    const result = await asMinor.mutation(api.members.updateProfile, {
      looking_for: ["Jobs", "Mentorship (as mentee)"],
    });
    expect(result.ok).toBe(true);

    const saved = await t.run(async (ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_email", (q) => q.eq("email", "activeminor@example.com"))
        .unique(),
    );
    expect(saved?.looking_for).toEqual(["Jobs"]);
  });
});

describe("under-13 join boundary (13+ vault lock)", () => {
  it("submitJoin rejects an under-13 DOB before any row is written", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(
      api.members.submitJoin,
      submitArgs("child@example.com", { dobAnswer: UNDER_13_DOB }),
    );
    expect(result).toEqual({ ok: false, error: "under_13" });

    const members = await t.run(async (ctx) =>
      ctx.db.query("members").collect(),
    );
    const consents = await t.run(async (ctx) =>
      ctx.db.query("consentRecords").collect(),
    );
    expect(members).toHaveLength(0);
    expect(consents).toHaveLength(0);
  });
});
