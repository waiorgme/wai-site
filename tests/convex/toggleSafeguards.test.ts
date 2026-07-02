import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { ensurePipelineReviewOnActivation } from "../../convex/lib/pipeline";
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

  it("a non-active member cannot enable either toggle, but that is lifecycle, not lane", async () => {
    const t = convexTest(schema, modules);
    const email = "pending@example.com";
    const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        ...memberRow(email, "standard", "female"),
        lifecycle_state: "pending_review",
        userId,
      });
    });
    const asPending = t.withIdentity({ subject: `${userId}|testsession` });
    expect(
      await asPending.mutation(api.members.setDirectoryVisible, { value: true }),
    ).toEqual({ ok: false, error: "not_active" });
    expect(
      await asPending.mutation(api.members.setPipelineOptIn, {
        value: true,
        attestation: true,
      }),
    ).toEqual({ ok: false, error: "not_active" });
  });

  it("revocation always works: a now-ineligible lane can still turn the pipeline OFF", async () => {
    const t = convexTest(schema, modules);
    // A member whose lane was reclassified after an earlier legitimate opt-in
    // (e.g. corrected DOB): stale review_pending state, lane no longer eligible.
    const email = "reclassified@example.com";
    const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", {
        ...memberRow(email, "restricted_unknown", "female"),
        pipeline_state: "review_pending" as const,
        userId,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("pipelineEligibilityReviews", {
        member_id: memberId,
        state: "pending",
        timestamp: Date.now(),
      });
    });
    const asMember = t.withIdentity({ subject: `${userId}|testsession` });
    const result = await asMember.mutation(api.members.setPipelineOptIn, {
      value: false,
    });
    expect(result).toEqual({ ok: true, pipeline_state: "off" });

    const reviews = await t.run(async (ctx) =>
      ctx.db.query("pipelineEligibilityReviews").collect(),
    );
    expect(reviews[0].state).toBe("rejected");
    expect(reviews[0].reason).toBe("withdrawn_by_member");
    const consents = await t.run(async (ctx) =>
      ctx.db.query("consentRecords").collect(),
    );
    expect(consents.filter((c) => c.type === "pipeline" && c.value === false)).toHaveLength(1);
  });

  it("invariant: an attested join/claim pipeline consent opens the review at activation, once", async () => {
    const t = convexTest(schema, modules);
    const email = "joined@example.com";
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow(email, "standard", "female")),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("consentRecords", {
        member_id: memberId,
        type: "pipeline",
        value: true,
        policy_version: "2026-07-02",
        source: "join",
        timestamp: Date.now(),
      });
    });
    await t.run(async (ctx) => {
      const member = await ctx.db.get(memberId);
      await ensurePipelineReviewOnActivation(ctx, member!);
      // Idempotent: a second activation event opens nothing new.
      const after = await ctx.db.get(memberId);
      await ensurePipelineReviewOnActivation(ctx, after!);
    });
    const reviews = await t.run(async (ctx) =>
      ctx.db.query("pipelineEligibilityReviews").collect(),
    );
    expect(reviews).toHaveLength(1);
    const member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.pipeline_state).toBe("review_pending");
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
