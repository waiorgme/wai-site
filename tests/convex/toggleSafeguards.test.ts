import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Opt-in toggles Gate 4 regressions: the pipeline toggle is women-only
// (standard lane ONLY, same rule as join/claim/writeConsent), while the
// directory toggle stays open to allies. Both locked for minors/unknown-age.

const modules = import.meta.glob("../../convex/**/*.*s");

const memberRow = (
  email: string,
  lane: "standard" | "ally" | "minor" | "restricted_unknown",
  gender: "female" | "male",
) => ({
  email,
  name: "Test Member",
  source: "new_signup" as const,
  lifecycle_state: "active" as const,
  date_of_birth: "1985-03-10",
  date_of_birth_source: "self_declared" as const,
  age_confidence: "declared" as const,
  guardian_consent_state: "not_required" as const,
  gender,
  career_stage_answer: "Working in aviation",
  member_lane: lane,
  created_at: Date.now(),
});

const signedInMember = async (
  t: ReturnType<typeof convexTest>,
  lane: "standard" | "ally",
  gender: "female" | "male",
) => {
  const email = `${lane}@example.com`;
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { ...memberRow(email, lane, gender), userId });
  });
  return t.withIdentity({ subject: `${userId}|testsession` });
};

describe("pipeline toggle is women-only (standard lane)", () => {
  it("an ally cannot opt in: refused, audited, no consent row, no review", async () => {
    const t = convexTest(schema, modules);
    const asAlly = await signedInMember(t, "ally", "male");
    const result = await asAlly.mutation(api.members.setPipelineOptIn, {
      value: true,
      attestation: true,
    });
    expect(result).toEqual({ ok: false, error: "not_permitted" });

    expect(
      await t.run(async (ctx) => ctx.db.query("consentRecords").collect()),
    ).toHaveLength(0);
    expect(
      await t.run(async (ctx) =>
        ctx.db.query("pipelineEligibilityReviews").collect(),
      ),
    ).toHaveLength(0);
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(
      audits.filter((a) => a.action === "setPipelineOptIn.refused"),
    ).toHaveLength(1);
  });

  it("an ally sees the pipeline toggle locked but can still use the directory toggle", async () => {
    const t = convexTest(schema, modules);
    const asAlly = await signedInMember(t, "ally", "male");
    const settings = await asAlly.query(api.members.getMySettings, {});
    expect(settings?.locked).toBe(false);
    expect(settings?.pipeline_locked).toBe(true);

    const dir = await asAlly.mutation(api.members.setDirectoryVisible, {
      value: true,
    });
    expect(dir).toEqual({ ok: true });
  });

  it("a standard member opts in: attested, consent row, review opened", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signedInMember(t, "standard", "female");
    const settings = await asMember.query(api.members.getMySettings, {});
    expect(settings?.pipeline_locked).toBe(false);

    const result = await asMember.mutation(api.members.setPipelineOptIn, {
      value: true,
      attestation: true,
    });
    expect(result).toEqual({ ok: true, pipeline_state: "review_pending" });
    expect(
      await t.run(async (ctx) =>
        ctx.db.query("pipelineEligibilityReviews").collect(),
      ),
    ).toHaveLength(1);
  });
});
