import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
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

  it("an adult's ticked pipeline box is stored as true, no refusal", async () => {
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
  });
});

describe("under-13 join boundary (13+ vault lock)", () => {
  it("submitJoin rejects an under-13 DOB before any row is written", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(api.members.submitJoin, {
      ...joinArgs("child@example.com", UNDER_13_DOB, false),
      turnstileToken: "irrelevant",
    });
    expect(result).toEqual({ ok: false, error: "underage" });

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
