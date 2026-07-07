import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// Opportunities Gate 5 tests (panel-experience spec B5-B8): lane gating is
// server-side and deny-by-default; applying needs an active lifecycle + a
// complete profile; one application per member per opportunity; evergreen
// takes no applications; late applies are refused; every applicant gets an
// answer (acknowledgement + result notifications); the deadline cron closes
// and audits; every admin function refuses non-admins.

const modules = import.meta.glob("../../convex/**/*.*s");

const ADMIN_EMAIL = "issam@example.com";
const NON_ADMIN = "member@example.com";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  process.env.SUPER_ADMIN_EMAILS = ADMIN_EMAIL;
});

const memberRow = (email: string, extra: Record<string, unknown> = {}) => ({
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
  const memberId = await t.run(async (ctx) =>
    ctx.db.insert("members", { ...memberRow(email, extra), userId }),
  );
  return { session: t.withIdentity({ subject: `${userId}|testsession` }), memberId };
};

// A member whose profile passes isProfileComplete (name + photo + career
// stage + function area + country), so applying can succeed and the Rung-2
// standing gate can fire.
const signInComplete = async (
  t: ReturnType<typeof convexTest>,
  email: string,
  extra: Record<string, unknown> = {},
) => {
  const photoId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["photo-bytes"])),
  );
  return signIn(t, email, {
    photo_storage_id: photoId,
    function_area: "Flight Operations",
    country_of_residence: "United Arab Emirates",
    ...extra,
  });
};

const oppRow = (extra: Record<string, unknown> = {}) => ({
  title: "WingsWay Scholarship",
  type: "competitive" as const,
  description: "Three funded training seats with WingsWay.",
  what_to_submit: "A personal statement of 300 to 500 words.",
  eligibility_note: "Members 18 or older.",
  audience: "women_only" as const,
  deadline: Date.now() + 7 * DAY,
  state: "open" as const,
  created_at: Date.now(),
  published_at: Date.now(),
  ...extra,
});

const insertOpp = async (
  t: ReturnType<typeof convexTest>,
  extra: Record<string, unknown> = {},
): Promise<Id<"opportunities">> =>
  t.run(async (ctx) => ctx.db.insert("opportunities", oppRow(extra)));

const auditRows = async (t: ReturnType<typeof convexTest>, action: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("auditLog")
      .filter((q) => q.eq(q.field("action"), action))
      .collect(),
  );

const notifications = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ctx.db.query("notifications").collect());

describe("lane gating (server-side, deny-by-default)", () => {
  it("a minor sees NO opportunities and a direct apply is refused + audited", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t);
    await insertOpp(t, { audience: "open", title: "Open Briefing" });
    const { session } = await signIn(t, "minor@example.com", {
      member_lane: "minor",
      date_of_birth: "2011-03-10",
    });
    expect(await session.query(api.opportunities.listOpportunities, {})).toEqual([]);
    expect(await session.query(api.opportunities.getOpportunity, { id: oppId })).toBeNull();
    const res = await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "I would like to apply.",
    });
    expect(res).toEqual({ ok: false, error: "not_eligible" });
    const refusals = await auditRows(t, "applyToOpportunity.refused");
    expect(refusals).toHaveLength(1);
    expect(refusals[0].after_summary).toContain("lane=minor");
    const apps = await t.run(async (ctx) =>
      ctx.db.query("opportunityApplications").collect(),
    );
    expect(apps).toHaveLength(0);
  });

  it("a restricted_unknown member sees nothing and cannot apply", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t, { audience: "open" });
    const { session } = await signIn(t, "unknown@example.com", {
      member_lane: "restricted_unknown",
      date_of_birth: undefined,
      age_confidence: "unknown",
      date_of_birth_source: "unknown",
    });
    expect(await session.query(api.opportunities.listOpportunities, {})).toEqual([]);
    expect(
      await session.mutation(api.opportunities.apply, {
        opportunityId: oppId,
        statement: "Please consider me.",
      }),
    ).toEqual({ ok: false, error: "not_eligible" });
  });

  it("an ally is hidden from women_only rows but sees open-audience rows", async () => {
    const t = convexTest(schema, modules);
    const womenOnlyId = await insertOpp(t, { title: "Women Only Scholarship" });
    await insertOpp(t, { audience: "open", title: "Open Mentoring Briefing" });
    const { session } = await signIn(t, "ally@example.com", {
      member_lane: "ally",
      gender: "male",
    });
    const board = await session.query(api.opportunities.listOpportunities, {});
    expect(board).toHaveLength(1);
    expect(board[0].title).toBe("Open Mentoring Briefing");
    // The women_only row answers exactly like a missing row.
    expect(
      await session.query(api.opportunities.getOpportunity, { id: womenOnlyId }),
    ).toBeNull();
    expect(
      await session.mutation(api.opportunities.apply, {
        opportunityId: womenOnlyId,
        statement: "Please consider me.",
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("a non-active member and a signed-out caller both get an empty board", async () => {
    const t = convexTest(schema, modules);
    await insertOpp(t);
    expect(await t.query(api.opportunities.listOpportunities, {})).toEqual([]);
    const { session } = await signIn(t, "dormant@example.com", {
      lifecycle_state: "dormant",
    });
    expect(await session.query(api.opportunities.listOpportunities, {})).toEqual([]);
  });
});

describe("apply", () => {
  it("refuses an incomplete profile with the profile_incomplete route", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t);
    // Standard lane, active, but no photo/function/country: not complete.
    const { session } = await signIn(t, NON_ADMIN);
    const res = await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "I am ready for this.",
    });
    expect(res).toEqual({ ok: false, error: "profile_incomplete" });
  });

  it("a complete-profile member applies: row + audit + acknowledgement + standing promotion", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t);
    const { session, memberId } = await signInComplete(t, "amal@example.com");
    const res = await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "Aviation is my path and this seat would change it.",
    });
    expect(res).toEqual({ ok: true });

    const apps = await t.run(async (ctx) =>
      ctx.db.query("opportunityApplications").collect(),
    );
    expect(apps).toHaveLength(1);
    expect(apps[0].state).toBe("received");
    expect(apps[0].member_id).toBe(memberId);

    const audits = await auditRows(t, "applyToOpportunity");
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe("amal@example.com");
    expect(audits[0].source).toBe("member");

    const notes = await notifications(t);
    const ack = notes.find((n) => n.type === "application_received");
    expect(ack).toBeDefined();
    expect(ack?.body).toBe(
      "We've got your application for WingsWay Scholarship. Every applicant hears back, win or lose.",
    );

    // Applying is a qualifying action: profile complete + applied promotes
    // member -> active_member (Rung 2), audited and notified in plain words.
    const member = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(member?.standing).toBe("active_member");
    const history = await t.run(async (ctx) =>
      ctx.db.query("standingHistory").collect(),
    );
    expect(history).toHaveLength(1);
    expect(history[0].reason).toContain("applied to an opportunity");
    expect(notes.some((n) => n.type === "standing_change")).toBe(true);
  });

  it("one application per member per opportunity: the second apply is already:true", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t);
    const { session } = await signInComplete(t, "amal@example.com");
    await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "First statement.",
    });
    const second = await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "Second statement.",
    });
    expect(second).toEqual({ ok: true, already: true });
    const apps = await t.run(async (ctx) =>
      ctx.db.query("opportunityApplications").collect(),
    );
    expect(apps).toHaveLength(1);
    expect(apps[0].statement).toBe("First statement.");
  });

  it("a late apply (open row, deadline passed) is politely refused with closed", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t, { deadline: Date.now() - 60 * 1000 });
    const { session } = await signInComplete(t, "amal@example.com");
    const res = await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "Am I too late?",
    });
    expect(res).toEqual({ ok: false, error: "closed" });
  });

  it("evergreen takes NO applications and carries the claim path instead", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t, {
      title: "Akademikka Discount",
      type: "evergreen",
      deadline: undefined,
      what_to_submit: undefined,
      how_to_claim: "Show your membership certificate to Akademikka when enrolling.",
    });
    const { session } = await signInComplete(t, "amal@example.com");
    expect(
      await session.mutation(api.opportunities.apply, {
        opportunityId: oppId,
        statement: "Claiming the discount.",
      }),
    ).toEqual({ ok: false, error: "evergreen" });

    const detail = await session.query(api.opportunities.getOpportunity, {
      id: oppId,
    });
    expect(detail?.how_to_claim).toContain("membership certificate");
    expect(detail?.what_to_submit).toBeNull();
  });

  it("a draft row is invisible: list, detail, and apply all answer nothing", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t, { state: "draft", published_at: undefined });
    const { session } = await signInComplete(t, "amal@example.com");
    expect(await session.query(api.opportunities.listOpportunities, {})).toEqual([]);
    expect(
      await session.query(api.opportunities.getOpportunity, { id: oppId }),
    ).toBeNull();
    expect(
      await session.mutation(api.opportunities.apply, {
        opportunityId: oppId,
        statement: "Trying a draft.",
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("the board carries her application state per row", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t);
    await insertOpp(t, { title: "Second Listing" });
    const { session } = await signInComplete(t, "amal@example.com");
    await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "My statement.",
    });
    const board = await session.query(api.opportunities.listOpportunities, {});
    expect(board).toHaveLength(2);
    const applied = board.find((r) => r.opportunityId === oppId);
    const other = board.find((r) => r.opportunityId !== oppId);
    expect(applied?.my_application_state).toBe("received");
    expect(other?.my_application_state).toBeNull();
  });
});

describe("withdraw + my applications", () => {
  it("received -> withdrawn, audited; withdrawing again is already:true", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t);
    const { session } = await signInComplete(t, "amal@example.com");
    await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "My statement.",
    });
    expect(
      await session.mutation(api.opportunities.withdrawMyApplication, {
        opportunityId: oppId,
      }),
    ).toEqual({ ok: true });
    const apps = await t.run(async (ctx) =>
      ctx.db.query("opportunityApplications").collect(),
    );
    expect(apps[0].state).toBe("withdrawn");
    expect(await auditRows(t, "withdrawMyApplication")).toHaveLength(1);
    expect(
      await session.mutation(api.opportunities.withdrawMyApplication, {
        opportunityId: oppId,
      }),
    ).toEqual({ ok: true, already: true });
  });

  it("re-applying after a withdrawal re-opens the SAME row (never a second one)", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t);
    const { session } = await signInComplete(t, "amal@example.com");
    await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "First try.",
    });
    await session.mutation(api.opportunities.withdrawMyApplication, {
      opportunityId: oppId,
    });
    const res = await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "Second try.",
    });
    expect(res).toEqual({ ok: true });
    const apps = await t.run(async (ctx) =>
      ctx.db.query("opportunityApplications").collect(),
    );
    expect(apps).toHaveLength(1);
    expect(apps[0].state).toBe("received");
    expect(apps[0].statement).toBe("Second try.");
  });

  it("a decided application cannot be withdrawn; myApplications tells the honest story", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t);
    const { session } = await signInComplete(t, "amal@example.com");
    await session.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "My statement.",
    });
    const asAdmin = (await signIn(t, ADMIN_EMAIL)).session;
    const apps = await asAdmin.query(api.admin.opportunities.listApplications, {
      opportunityId: oppId,
    });
    await asAdmin.mutation(api.admin.opportunities.recordResult, {
      applicationId: apps[0].applicationId,
      result: "won",
    });
    expect(
      await session.mutation(api.opportunities.withdrawMyApplication, {
        opportunityId: oppId,
      }),
    ).toEqual({ ok: false, error: "decided" });
    const mine = await session.query(api.opportunities.myApplications, {});
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("WingsWay Scholarship");
    expect(mine[0].state).toBe("won");
  });
});

describe("admin gating: non-admin refused everywhere", () => {
  it("every admin query throws and every admin mutation returns the neutral envelope", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t);
    const applicantId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("applicant@example.com")),
    );
    const applicationId = await t.run(async (ctx) =>
      ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: applicantId,
        statement: "Hi.",
        state: "received",
        created_at: Date.now(),
      }),
    );
    const { session } = await signIn(t, NON_ADMIN);

    await expect(
      session.query(api.admin.opportunities.adminListOpportunities, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      session.query(api.admin.opportunities.getOpportunityAdmin, { id: oppId }),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      session.query(api.admin.opportunities.listApplications, {
        opportunityId: oppId,
      }),
    ).rejects.toThrow(/not_authorized/);

    expect(
      await session.mutation(api.admin.opportunities.upsertOpportunity, {
        title: "X",
        type: "competitive",
        description: "X",
        deadline: Date.now() + DAY,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await session.mutation(api.admin.opportunities.publishOpportunity, {
        id: oppId,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await session.mutation(api.admin.opportunities.closeOpportunity, {
        id: oppId,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await session.mutation(api.admin.opportunities.setShortlisted, {
        applicationId,
        on: true,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await session.mutation(api.admin.opportunities.recordResult, {
        applicationId,
        result: "won",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await session.mutation(api.admin.opportunities.decideOpportunity, {
        opportunityId: oppId,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });

    // Nothing moved.
    const app = await t.run(async (ctx) => ctx.db.get(applicationId));
    expect(app?.state).toBe("received");

    // Unauthenticated callers are refused too.
    await expect(
      t.query(api.admin.opportunities.adminListOpportunities, {}),
    ).rejects.toThrow(/not_authorized/);
  });
});

describe("admin lifecycle", () => {
  it("upsert validates the type-specific shape", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = (await signIn(t, ADMIN_EMAIL)).session;
    // Evergreen with a deadline: refused.
    expect(
      await asAdmin.mutation(api.admin.opportunities.upsertOpportunity, {
        title: "Bad Evergreen",
        type: "evergreen",
        description: "A benefit.",
        how_to_claim: "Ask the partner.",
        deadline: Date.now() + DAY,
      }),
    ).toEqual({ ok: false, error: "validation" });
    // Evergreen without how_to_claim: refused.
    expect(
      await asAdmin.mutation(api.admin.opportunities.upsertOpportunity, {
        title: "Bad Evergreen",
        type: "evergreen",
        description: "A benefit.",
      }),
    ).toEqual({ ok: false, error: "validation" });
    // Competitive without a deadline: refused.
    expect(
      await asAdmin.mutation(api.admin.opportunities.upsertOpportunity, {
        title: "Bad Competitive",
        type: "competitive",
        description: "A scholarship.",
      }),
    ).toEqual({ ok: false, error: "validation" });
    // A valid competitive listing lands as an audited draft.
    const res = await asAdmin.mutation(api.admin.opportunities.upsertOpportunity, {
      title: "WingsWay Scholarship",
      type: "competitive",
      description: "Three seats.",
      deadline: Date.now() + 7 * DAY,
    });
    expect(res).toMatchObject({ ok: true });
    if (res.ok) {
      const row = await t.run(async (ctx) => ctx.db.get(res.id));
      expect(row?.state).toBe("draft");
      expect(row?.audience).toBe("women_only");
    }
    expect(await auditRows(t, "upsertOpportunity")).toHaveLength(1);
  });

  it("publish: draft -> open with published_at + audit; republish is already:true; past deadline refused", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = (await signIn(t, ADMIN_EMAIL)).session;
    const draftId = await insertOpp(t, { state: "draft", published_at: undefined });
    expect(
      await asAdmin.mutation(api.admin.opportunities.publishOpportunity, {
        id: draftId,
      }),
    ).toEqual({ ok: true });
    const row = await t.run(async (ctx) => ctx.db.get(draftId));
    expect(row?.state).toBe("open");
    expect(row?.published_at).toBeDefined();
    expect(await auditRows(t, "publishOpportunity")).toHaveLength(1);
    expect(
      await asAdmin.mutation(api.admin.opportunities.publishOpportunity, {
        id: draftId,
      }),
    ).toEqual({ ok: true, already: true });

    const staleId = await insertOpp(t, {
      state: "draft",
      published_at: undefined,
      deadline: Date.now() - DAY,
    });
    expect(
      await asAdmin.mutation(api.admin.opportunities.publishOpportunity, {
        id: staleId,
      }),
    ).toEqual({ ok: false, error: "validation" });
  });

  it("close: open -> closed with the reason in the audit trail", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = (await signIn(t, ADMIN_EMAIL)).session;
    const oppId = await insertOpp(t);
    expect(
      await asAdmin.mutation(api.admin.opportunities.closeOpportunity, {
        id: oppId,
        reason: "partner paused the intake",
      }),
    ).toEqual({ ok: true });
    const row = await t.run(async (ctx) => ctx.db.get(oppId));
    expect(row?.state).toBe("closed");
    const audits = await auditRows(t, "closeOpportunity");
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe(ADMIN_EMAIL);
    expect(audits[0].after_summary).toContain("partner paused the intake");
    expect(
      await asAdmin.mutation(api.admin.opportunities.closeOpportunity, {
        id: oppId,
      }),
    ).toEqual({ ok: true, already: true });
  });

  it("shortlist mark moves received <-> shortlisted and never touches decided rows", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = (await signIn(t, ADMIN_EMAIL)).session;
    const oppId = await insertOpp(t);
    const applicantId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("applicant@example.com")),
    );
    const applicationId = await t.run(async (ctx) =>
      ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: applicantId,
        statement: "Hi.",
        state: "received",
        created_at: Date.now(),
      }),
    );
    expect(
      await asAdmin.mutation(api.admin.opportunities.setShortlisted, {
        applicationId,
        on: true,
      }),
    ).toEqual({ ok: true });
    expect(
      (await t.run(async (ctx) => ctx.db.get(applicationId)))?.state,
    ).toBe("shortlisted");
    expect(
      await asAdmin.mutation(api.admin.opportunities.setShortlisted, {
        applicationId,
        on: false,
      }),
    ).toEqual({ ok: true });
    expect(
      (await t.run(async (ctx) => ctx.db.get(applicationId)))?.state,
    ).toBe("received");
    expect(await auditRows(t, "setShortlisted")).toHaveLength(2);

    await asAdmin.mutation(api.admin.opportunities.recordResult, {
      applicationId,
      result: "lost",
    });
    expect(
      await asAdmin.mutation(api.admin.opportunities.setShortlisted, {
        applicationId,
        on: true,
      }),
    ).toEqual({ ok: false, error: "conflict" });
  });

  it("recording a result notifies the applicant, win AND lose, with the decided copy", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = (await signIn(t, ADMIN_EMAIL)).session;
    const oppId = await insertOpp(t);
    const winnerId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("winner@example.com", { name: "Amal Haddad" })),
    );
    const loserId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("runnerup@example.com", { name: "Sara Hassan" })),
    );
    const wonAppId = await t.run(async (ctx) =>
      ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: winnerId,
        statement: "Pick me.",
        state: "shortlisted",
        created_at: Date.now(),
      }),
    );
    const lostAppId = await t.run(async (ctx) =>
      ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: loserId,
        statement: "Me too.",
        state: "received",
        created_at: Date.now(),
      }),
    );

    expect(
      await asAdmin.mutation(api.admin.opportunities.recordResult, {
        applicationId: wonAppId,
        result: "won",
        note: "unanimous partner pick",
      }),
    ).toEqual({ ok: true });
    expect(
      await asAdmin.mutation(api.admin.opportunities.recordResult, {
        applicationId: lostAppId,
        result: "lost",
      }),
    ).toEqual({ ok: true });

    const notes = await notifications(t);
    const wonNote = notes.find((n) => n.member_id === winnerId);
    const lostNote = notes.find((n) => n.member_id === loserId);
    expect(wonNote?.type).toBe("application_result");
    expect(wonNote?.body).toContain("WingsWay Scholarship");
    expect(wonNote?.body).toContain("Congratulations");
    expect(lostNote?.type).toBe("application_result");
    expect(lostNote?.body).toBe(
      "Thank you for applying to WingsWay Scholarship. This one went to another member. Your profile stays in the running for what comes next - keep an eye on Opportunities.",
    );

    // The note stays on the row; the immutable audit summary carries a flag,
    // never the raw text.
    const wonApp = await t.run(async (ctx) => ctx.db.get(wonAppId));
    expect(wonApp?.result_note).toBe("unanimous partner pick");
    const audits = await auditRows(t, "recordResult");
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain("unanimous partner pick");
    expect(audits[0].after_summary).toContain("note_present=true");

    // Same result again is idempotent; flipping a decided result is refused.
    expect(
      await asAdmin.mutation(api.admin.opportunities.recordResult, {
        applicationId: wonAppId,
        result: "won",
      }),
    ).toEqual({ ok: true, already: true });
    expect(
      await asAdmin.mutation(api.admin.opportunities.recordResult, {
        applicationId: wonAppId,
        result: "lost",
      }),
    ).toEqual({ ok: false, error: "conflict" });
  });

  it("decideOpportunity blocks while any non-withdrawn application lacks a result", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = (await signIn(t, ADMIN_EMAIL)).session;
    const oppId = await insertOpp(t, { state: "closed" });
    const aId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("a@example.com")),
    );
    const bId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("b@example.com")),
    );
    const pendingAppId = await t.run(async (ctx) =>
      ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: aId,
        statement: "Waiting.",
        state: "received",
        created_at: Date.now(),
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: bId,
        statement: "Withdrawn.",
        state: "withdrawn",
        created_at: Date.now(),
      }),
    );

    // One received application still waiting for its answer: blocked.
    expect(
      await asAdmin.mutation(api.admin.opportunities.decideOpportunity, {
        opportunityId: oppId,
      }),
    ).toEqual({ ok: false, error: "unresolved_applications" });

    await asAdmin.mutation(api.admin.opportunities.recordResult, {
      applicationId: pendingAppId,
      result: "won",
    });
    // Every non-withdrawn application now has a result (withdrawn ignored).
    expect(
      await asAdmin.mutation(api.admin.opportunities.decideOpportunity, {
        opportunityId: oppId,
      }),
    ).toEqual({ ok: true });
    const row = await t.run(async (ctx) => ctx.db.get(oppId));
    expect(row?.state).toBe("decided");
    expect(row?.result_published_at).toBeDefined();
    expect(await auditRows(t, "decideOpportunity")).toHaveLength(1);

    // Idempotent once decided; an OPEN listing must be closed first.
    expect(
      await asAdmin.mutation(api.admin.opportunities.decideOpportunity, {
        opportunityId: oppId,
      }),
    ).toEqual({ ok: true, already: true });
    const openId = await insertOpp(t);
    expect(
      await asAdmin.mutation(api.admin.opportunities.decideOpportunity, {
        opportunityId: openId,
      }),
    ).toEqual({ ok: false, error: "not_closed" });
  });

  it("listApplications shows name + standing + statement, never an email; adminList counts applications", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = (await signIn(t, ADMIN_EMAIL)).session;
    const oppId = await insertOpp(t);
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert(
        "members",
        memberRow("applicant@example.com", {
          name: "Amal Haddad",
          standing: "active_member",
        }),
      ),
    );
    const otherId = await t.run(async (ctx) =>
      ctx.db.insert("members", memberRow("withdrawer@example.com")),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: memberId,
        statement: "My statement.",
        state: "received",
        created_at: Date.now(),
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: otherId,
        statement: "Changed my mind.",
        state: "withdrawn",
        created_at: Date.now(),
      }),
    );

    const rows = await asAdmin.query(api.admin.opportunities.listApplications, {
      opportunityId: oppId,
    });
    expect(rows).toHaveLength(2);
    const amal = rows.find((r) => r.applicant_name === "Amal Haddad");
    expect(amal?.standing).toBe("active_member");
    expect(amal?.statement).toBe("My statement.");
    expect(JSON.stringify(rows)).not.toContain("@example.com");

    const list = await asAdmin.query(
      api.admin.opportunities.adminListOpportunities,
      {},
    );
    expect(list).toHaveLength(1);
    expect(list[0].application_counts.active).toBe(1);
    expect(list[0].application_counts.withdrawn).toBe(1);

    const detail = await asAdmin.query(
      api.admin.opportunities.getOpportunityAdmin,
      { id: oppId },
    );
    expect(detail?.application_counts.received).toBe(1);
  });
});

describe("deadline cron", () => {
  it("closes only past-deadline OPEN rows, one system audit row per close, idempotent", async () => {
    const t = convexTest(schema, modules);
    const pastId = await insertOpp(t, {
      title: "Past Deadline",
      deadline: Date.now() - 60 * 1000,
    });
    const futureId = await insertOpp(t, { title: "Future Deadline" });
    const evergreenId = await insertOpp(t, {
      title: "Evergreen Benefit",
      type: "evergreen",
      deadline: undefined,
      how_to_claim: "Show your membership certificate.",
    });
    const draftPastId = await insertOpp(t, {
      title: "Draft Past",
      state: "draft",
      published_at: undefined,
      deadline: Date.now() - 60 * 1000,
    });

    const first = await t.mutation(
      internal.admin.opportunities.closePastDeadlineOpportunities,
      {},
    );
    expect(first).toEqual({ closed: 1 });

    expect((await t.run(async (ctx) => ctx.db.get(pastId)))?.state).toBe("closed");
    expect((await t.run(async (ctx) => ctx.db.get(futureId)))?.state).toBe("open");
    expect((await t.run(async (ctx) => ctx.db.get(evergreenId)))?.state).toBe("open");
    expect((await t.run(async (ctx) => ctx.db.get(draftPastId)))?.state).toBe("draft");

    const audits = await auditRows(t, "autoCloseOpportunity");
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe("system");
    expect(audits[0].source).toBe("system");
    expect(audits[0].target_id).toBe(pastId);

    // Second run: nothing left to close, no duplicate audit rows.
    const second = await t.mutation(
      internal.admin.opportunities.closePastDeadlineOpportunities,
      {},
    );
    expect(second).toEqual({ closed: 0 });
    expect(await auditRows(t, "autoCloseOpportunity")).toHaveLength(1);
  });
});

describe("single_winner integrity (Gate 4, 2026-07-07): exactly one winner", () => {
  it("a second 'won' on a single_winner listing is refused; 'lost' still flows; decide succeeds", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t, {
      title: "Type Rating Sponsorship",
      type: "single_winner" as const,
    });
    const { session: a } = await signInComplete(t, "a@example.com");
    const { session: b } = await signInComplete(t, "b@example.com");
    await a.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "I would like to apply.",
    });
    await b.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "Me too, please consider me.",
    });
    const { session: asAdmin } = await signIn(t, ADMIN_EMAIL);
    const apps = await t.run(async (ctx) =>
      ctx.db.query("opportunityApplications").collect(),
    );

    expect(
      await asAdmin.mutation(api.admin.opportunities.recordResult, {
        applicationId: apps[0]._id,
        result: "won",
      }),
    ).toEqual({ ok: true });
    // The second winner is refused, and the refused application is untouched.
    expect(
      await asAdmin.mutation(api.admin.opportunities.recordResult, {
        applicationId: apps[1]._id,
        result: "won",
      }),
    ).toEqual({ ok: false, error: "winner_exists" });
    const untouched = await t.run(async (ctx) => ctx.db.get(apps[1]._id));
    expect(untouched!.state).toBe("received");

    // Everyone still gets an answer: lost flows normally, then decide works.
    expect(
      await asAdmin.mutation(api.admin.opportunities.recordResult, {
        applicationId: apps[1]._id,
        result: "lost",
      }),
    ).toEqual({ ok: true });
    await t.run(async (ctx) => ctx.db.patch(oppId, { state: "closed" }));
    expect(
      await asAdmin.mutation(api.admin.opportunities.decideOpportunity, {
        opportunityId: oppId,
      }),
    ).toEqual({ ok: true });
  });

  it("decideOpportunity refuses a single_winner cycle that somehow carries two winners", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t, {
      type: "single_winner" as const,
      state: "closed" as const,
    });
    const { memberId: m1 } = await signIn(t, "w1@example.com");
    const { memberId: m2 } = await signIn(t, "w2@example.com");
    await t.run(async (ctx) => {
      for (const member_id of [m1, m2]) {
        await ctx.db.insert("opportunityApplications", {
          opportunity_id: oppId,
          member_id,
          statement: "Test application.",
          state: "won",
          created_at: Date.now(),
        });
      }
    });
    const { session: asAdmin } = await signIn(t, ADMIN_EMAIL);
    expect(
      await asAdmin.mutation(api.admin.opportunities.decideOpportunity, {
        opportunityId: oppId,
      }),
    ).toEqual({ ok: false, error: "multiple_winners" });
  });

  it("competitive listings still allow several winners", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t); // competitive by default
    const { session: a } = await signInComplete(t, "c1@example.com");
    const { session: b } = await signInComplete(t, "c2@example.com");
    await a.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "Applying for a seat.",
    });
    await b.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "Applying as well.",
    });
    const { session: asAdmin } = await signIn(t, ADMIN_EMAIL);
    const apps = await t.run(async (ctx) =>
      ctx.db.query("opportunityApplications").collect(),
    );
    for (const app of apps) {
      expect(
        await asAdmin.mutation(api.admin.opportunities.recordResult, {
          applicationId: app._id,
          result: "won",
        }),
      ).toEqual({ ok: true });
    }
  });
});

describe("audience freezes once open (Gate 4 round 3)", () => {
  it("an open listing's audience cannot change; a draft's still can", async () => {
    const t = convexTest(schema, modules);
    const { session: asAdmin } = await signIn(t, ADMIN_EMAIL);
    const created = await asAdmin.mutation(
      api.admin.opportunities.upsertOpportunity,
      {
        title: "Open Briefing",
        type: "competitive",
        description: "A funded seat.",
        audience: "open",
        deadline: Date.now() + 7 * DAY,
      },
    );
    const id = (created as { ok: true; id: Id<"opportunities"> }).id;

    // Draft: audience is still a free choice.
    expect(
      (
        await asAdmin.mutation(api.admin.opportunities.upsertOpportunity, {
          id,
          title: "Open Briefing",
          type: "competitive",
          description: "A funded seat.",
          audience: "women_only",
          deadline: Date.now() + 7 * DAY,
        })
      ).ok,
    ).toBe(true);
    await asAdmin.mutation(api.admin.opportunities.upsertOpportunity, {
      id,
      title: "Open Briefing",
      type: "competitive",
      description: "A funded seat.",
      audience: "open",
      deadline: Date.now() + 7 * DAY,
    });
    await asAdmin.mutation(api.admin.opportunities.publishOpportunity, { id });

    // Open: an ally may hold an application; narrowing is refused.
    expect(
      await asAdmin.mutation(api.admin.opportunities.upsertOpportunity, {
        id,
        title: "Open Briefing",
        type: "competitive",
        description: "A funded seat.",
        audience: "women_only",
        deadline: Date.now() + 7 * DAY,
      }),
    ).toEqual({ ok: false, error: "audience_locked" });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.audience).toBe("open");
  });

  it("a win is refused for an applicant who no longer passes the rules; lost still flows", async () => {
    const t = convexTest(schema, modules);
    const oppId = await insertOpp(t, { audience: "open" as const });
    const { session: applicant, memberId } = await signInComplete(
      t,
      "since-restricted@example.com",
    );
    await applicant.mutation(api.opportunities.apply, {
      opportunityId: oppId,
      statement: "Applying while eligible.",
    });
    // Her record is later corrected: unknown age = restricted lane.
    await t.run(async (ctx) => {
      await ctx.db.patch(memberId, {
        member_lane: "restricted_unknown" as const,
        date_of_birth: undefined,
        age_confidence: "unknown" as const,
        date_of_birth_source: "unknown" as const,
      });
    });
    const { session: asAdmin } = await signIn(t, ADMIN_EMAIL);
    const apps = await t.run(async (ctx) =>
      ctx.db.query("opportunityApplications").collect(),
    );
    expect(
      await asAdmin.mutation(api.admin.opportunities.recordResult, {
        applicationId: apps[0]._id,
        result: "won",
      }),
    ).toEqual({ ok: false, error: "not_eligible" });
    // Everyone still gets an answer.
    expect(
      await asAdmin.mutation(api.admin.opportunities.recordResult, {
        applicationId: apps[0]._id,
        result: "lost",
      }),
    ).toEqual({ ok: true });
  });
});
