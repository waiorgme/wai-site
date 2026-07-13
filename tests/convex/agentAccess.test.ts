import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Agent access keys (convex/agent.ts): deny-by-default gate for the curated
// surface a super-admin's AI agent may call. These tests pin the security
// properties: keys only mint for allowlisted emails, a bad/revoked key fails
// neutrally, a demoted owner's key stops working, and writes attribute to the
// key owner with source "agent".

const modules = import.meta.glob("../../convex/**/*.*s");

const ADMIN = "mervat@waiorg.me";

describe("agent access keys", () => {
  beforeEach(() => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", ADMIN);
  });

  it("issues a key only for a current super-admin", async () => {
    const t = convexTest(schema, modules);
    const issued = await t.mutation(internal.agent.issueAgentKey, {
      email: ADMIN,
    });
    expect(issued.key).toMatch(/^wai_agent_[0-9a-f]{64}$/);
    expect(issued.admin_email).toBe(ADMIN);

    await expect(
      t.mutation(internal.agent.issueAgentKey, {
        email: "stranger@example.com",
      }),
    ).rejects.toThrow("not_authorized");
  });

  it("whoami resolves the owner for a valid key and rejects a bad one", async () => {
    const t = convexTest(schema, modules);
    const { key } = await t.mutation(internal.agent.issueAgentKey, {
      email: ADMIN,
    });
    const me = await t.query(api.agent.whoami, { agentKey: key });
    expect(me.admin_email).toBe(ADMIN);
    expect(me.surface).toContain("resendGuardianEmail");

    await expect(
      t.query(api.agent.whoami, { agentKey: "wai_agent_wrong" }),
    ).rejects.toThrow("not_authorized");
  });

  it("a revoked key stops working", async () => {
    const t = convexTest(schema, modules);
    const { key } = await t.mutation(internal.agent.issueAgentKey, {
      email: ADMIN,
    });
    const { revoked } = await t.mutation(internal.agent.revokeAgentKeys, {
      email: ADMIN,
    });
    expect(revoked).toBe(1);
    await expect(t.query(api.agent.whoami, { agentKey: key })).rejects.toThrow(
      "not_authorized",
    );
  });

  it("a key dies with its owner's allowlist entry", async () => {
    const t = convexTest(schema, modules);
    const { key } = await t.mutation(internal.agent.issueAgentKey, {
      email: ADMIN,
    });
    vi.stubEnv("SUPER_ADMIN_EMAILS", "someoneelse@waiorg.me");
    await expect(t.query(api.agent.whoami, { agentKey: key })).rejects.toThrow(
      "not_authorized",
    );
  });

  const insertMember = async (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) =>
      ctx.db.insert("members", {
        name: "Test Member",
        email: "member@example.com",
        source: "new_signup",
        lifecycle_state: "active",
        date_of_birth_source: "self_declared",
        age_confidence: "declared",
        guardian_consent_state: "not_required",
        gender: "female",
        member_lane: "standard",
        created_at: Date.now(),
      }),
    );

  it("write tools return the neutral envelope for a bad key", async () => {
    const t = convexTest(schema, modules);
    const memberId = await insertMember(t);
    const note = await t.mutation(api.agent.addMemberNote, {
      agentKey: "nope",
      memberId,
      text: "hello",
    });
    expect(note).toEqual({ ok: false, error: "not_authorized" });
  });

  const insertEvent = async (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) =>
      ctx.db.insert("events", {
        title: "Original Title",
        category: "meetup",
        short_description: "A meetup.",
        starts_at: Date.parse("2026-09-14T17:00:00Z"),
        ends_at: Date.parse("2026-09-14T19:00:00Z"),
        timezone: "GST",
        format: "in_person",
        audience_lane: "adult",
        state: "published",
        created_at: Date.now(),
      }),
    );

  it("updateEventDetails patches allowed fields and audits as agent", async () => {
    const t = convexTest(schema, modules);
    const { key } = await t.mutation(internal.agent.issueAgentKey, {
      email: ADMIN,
    });
    const eventId = await insertEvent(t);
    const res = await t.mutation(api.agent.updateEventDetails, {
      agentKey: key,
      eventId,
      venue: "Jumeirah Creekside Hotel",
      meeting_link: "https://example.org/register",
    });
    expect(res).toEqual({ ok: true, updated: ["venue", "meeting_link"] });
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.venue).toBe("Jumeirah Creekside Hotel");
    expect(event?.meeting_link).toBe("https://example.org/register");
    const audit = await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.filter((r) => r.action === "updateEventDetails");
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].source).toBe("agent");
  });

  it("updateEventDetails rejects unsafe links, bad times, and bad keys", async () => {
    const t = convexTest(schema, modules);
    const { key } = await t.mutation(internal.agent.issueAgentKey, {
      email: ADMIN,
    });
    const eventId = await insertEvent(t);
    const badLink = await t.mutation(api.agent.updateEventDetails, {
      agentKey: key,
      eventId,
      meeting_link: "http://insecure.example.org",
    });
    expect(badLink).toMatchObject({ ok: false, error: "validation" });
    const badTimes = await t.mutation(api.agent.updateEventDetails, {
      agentKey: key,
      eventId,
      ends_at: "2026-09-14T16:00:00Z",
    });
    expect(badTimes).toMatchObject({ ok: false, error: "validation" });
    const badKey = await t.mutation(api.agent.updateEventDetails, {
      agentKey: "nope",
      eventId,
      title: "Hijacked",
    });
    expect(badKey).toEqual({ ok: false, error: "not_authorized" });
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.title).toBe("Original Title");
    expect(event?.meeting_link).toBeUndefined();
  });

  it("agent notes attribute to the key owner with source agent", async () => {
    const t = convexTest(schema, modules);
    const { key } = await t.mutation(internal.agent.issueAgentKey, {
      email: ADMIN,
    });
    const memberId = await insertMember(t);
    const res = await t.mutation(api.agent.addMemberNote, {
      agentKey: key,
      memberId,
      text: "Followed up by phone.",
    });
    expect(res.ok).toBe(true);
    const audit = await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLog").collect();
      return rows.filter((r) => r.action === "addMemberNote");
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe(ADMIN);
    expect(audit[0].source).toBe("agent");
    expect(audit[0].after_summary).not.toContain("Followed up");
  });
});
