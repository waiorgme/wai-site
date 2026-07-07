import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

// Members admin + certificates admin (panel-experience spec §F13-15). Drives
// the real functions through convex-test: deny-by-default gating, the no-email
// list surface, the audited contact reveal, the legal status-transition
// matrix, attributed notes with PII-free audit, the completeness formula, the
// certificate revoke / re-issue supersedes chain, and the issuance
// notification.

const modules = import.meta.glob("../../convex/**/*.*s");

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => ({ error: null }),
    };
  },
}));

const ADMIN_EMAIL = "issam@example.com";
const NON_ADMIN = "member@example.com";

beforeEach(() => {
  process.env.SUPER_ADMIN_EMAILS = ADMIN_EMAIL;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  process.env.AUTH_RESEND_KEY = "test-key";
  process.env.SITE_URL = "http://localhost:4321";
});

afterEach(() => {
  vi.restoreAllMocks();
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
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { ...memberRow(email, extra), userId });
  });
  return t.withIdentity({ subject: `${userId}|testsession` });
};

const insertMember = async (
  t: ReturnType<typeof convexTest>,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<Id<"members">> =>
  t.run(async (ctx) => ctx.db.insert("members", memberRow(email, extra)));

describe("members admin: deny-by-default", () => {
  it("a non-admin member is refused on every query and mutation", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    const targetId = await insertMember(t, "target@example.com");
    await expect(
      asMember.query(api.admin.members.listMembers, {}),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asMember.query(api.admin.members.getMemberAdmin, { memberId: targetId }),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asMember.query(api.admin.members.listMemberNotes, { memberId: targetId }),
    ).rejects.toThrow(/not_authorized/);
    await expect(
      asMember.query(api.admin.certificates.listCertificates, {}),
    ).rejects.toThrow(/not_authorized/);
    expect(
      await asMember.mutation(api.admin.members.revealMemberContact, {
        memberId: targetId,
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.members.changeMemberStatus, {
        memberId: targetId,
        to: "dormant",
        reason: "trying it on",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.members.addMemberNote, {
        memberId: targetId,
        text: "should never land",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
  });

  it("an unauthenticated caller is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.admin.members.listMembers, {})).rejects.toThrow(
      /not_authorized/,
    );
    await expect(
      t.query(api.admin.certificates.listCertificates, {}),
    ).rejects.toThrow(/not_authorized/);
  });
});

describe("members list", () => {
  it("rows carry NO email even when search matched on email", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    await insertMember(t, "amira@example.com", { name: "Amira Al Farsi" });
    await insertMember(t, "sara@example.com", { name: "Sara Hassan" });
    const result = await asAdmin.query(api.admin.members.listMembers, {
      search: "amira@example",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("Amira Al Farsi");
    const serialized = JSON.stringify(result.rows);
    expect(serialized).not.toContain("@");
    expect("email" in result.rows[0]).toBe(false);
  });

  it("lifecycle filter + chip counts", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    await insertMember(t, "a@example.com");
    await insertMember(t, "b@example.com", { lifecycle_state: "dormant" });
    await insertMember(t, "c@example.com", { lifecycle_state: "suspended" });
    const result = await asAdmin.query(api.admin.members.listMembers, {
      lifecycle: "dormant",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].lifecycle_state).toBe("dormant");
    // Counts cover every state whatever the active filter (the admin row
    // itself is active too).
    expect(result.lifecycle_counts.active).toBe(2);
    expect(result.lifecycle_counts.dormant).toBe(1);
    expect(result.lifecycle_counts.suspended).toBe(1);
    expect(result.lifecycle_counts.archived).toBe(0);
  });

  it("completeness formula: bare member 12, fully filled 100", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    await insertMember(t, "bare@example.com", {
      name: "Bare Member",
      career_stage_answer: undefined,
    });
    const photoId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
    );
    await insertMember(t, "full@example.com", {
      name: "Full Member",
      photo_storage_id: photoId,
      career_stage_answer: "Working in aviation",
      function_area: "Flight Operations",
      country_of_residence: "United Arab Emirates",
      bio: "Twenty years in the flight deck.",
      years_in_aviation: "10-20",
      highest_qualification: "Bachelor's degree",
      looking_for: ["Networking"],
    });
    const result = await asAdmin.query(api.admin.members.listMembers, {});
    const byName = new Map(result.rows.map((r) => [r.name, r.completeness_pct]));
    // Bare: only name of the five canonical fields (12 each, 60 total).
    expect(byName.get("Bare Member")).toBe(12);
    // Full: all five canonical (60) + bio + experience + qualifications +
    // looking_for (10 each) = 100.
    expect(byName.get("Full Member")).toBe(100);
  });
});

describe("member dossier", () => {
  it("masks contact, joins engagement titles, summarises consents", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await insertMember(t, "amira@example.com", {
      name: "Amira Al Farsi",
      mobile: "+971501234589",
    });
    await t.run(async (ctx) => {
      const eventId = await ctx.db.insert("events", {
        title: "Story Session: How I Got In",
        category: "story_session",
        short_description: "A member story session.",
        starts_at: Date.now() + 86_400_000,
        ends_at: Date.now() + 90_000_000,
        timezone: "GST",
        format: "online",
        audience_lane: "adult",
        state: "published",
        created_at: Date.now(),
      });
      await ctx.db.insert("eventRegistrations", {
        event_id: eventId,
        member_id: memberId,
        state: "registered",
        checkin_code: "code-1",
        created_at: Date.now(),
      });
      const oppId = await ctx.db.insert("opportunities", {
        title: "WingsWay Scholarship",
        type: "competitive",
        description: "Three seats.",
        audience: "women_only",
        state: "open",
        created_at: Date.now(),
      });
      await ctx.db.insert("opportunityApplications", {
        opportunity_id: oppId,
        member_id: memberId,
        state: "received",
        created_at: Date.now(),
      });
      // Two consent rows for one type: the summary must keep the LATEST only.
      await ctx.db.insert("consentRecords", {
        member_id: memberId,
        type: "marketing",
        value: true,
        policy_version: "v1",
        source: "join",
        timestamp: 1000,
      });
      await ctx.db.insert("consentRecords", {
        member_id: memberId,
        type: "marketing",
        value: false,
        policy_version: "v1",
        source: "settings",
        timestamp: 2000,
      });
      await ctx.db.insert("standingHistory", {
        member_id: memberId,
        from_standing: "member",
        to_standing: "active_member",
        reason: "profile complete + attended an event",
        timestamp: Date.now(),
      });
    });
    const dossier = await asAdmin.query(api.admin.members.getMemberAdmin, {
      memberId,
    });
    expect(dossier).not.toBeNull();
    // Contact stays masked: never the raw address or number.
    expect(dossier?.masked_email).toBe("a***@example.com");
    expect(dossier?.masked_email).not.toBe("amira@example.com");
    expect(dossier?.masked_mobile).toBe("*** 89");
    expect(JSON.stringify(dossier)).not.toContain("amira@example.com");
    expect(JSON.stringify(dossier)).not.toContain("+971501234589");
    expect(dossier?.registrations[0].event_title).toBe(
      "Story Session: How I Got In",
    );
    expect(dossier?.applications[0].opportunity_title).toBe(
      "WingsWay Scholarship",
    );
    const marketing = dossier?.consents.find((c) => c.type === "marketing");
    expect(marketing?.value).toBe(false);
    expect(dossier?.consents).toHaveLength(1);
    expect(dossier?.standing_history[0].to_standing).toBe("active_member");
    expect(dossier?.guardian).toBeNull();
  });

  it("surfaces guardian state for a minor with a masked guardian name", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await insertMember(t, "kid@example.com", {
      name: "Sara Hassan",
      member_lane: "minor",
      lifecycle_state: "pending_guardian",
      guardian_consent_state: "pending",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("guardianConsents", {
        member_id: memberId,
        guardian_name: "Huda Hassan",
        guardian_email: "huda@example.com",
        confirmation_state: "pending",
        confirmation_token_hash: "hash",
        timestamp: Date.now(),
      });
    });
    const dossier = await asAdmin.query(api.admin.members.getMemberAdmin, {
      memberId,
    });
    expect(dossier?.guardian).toEqual({
      consent_state: "pending",
      masked_guardian_name: "Huda H.",
      confirmation_state: "pending",
    });
    expect(JSON.stringify(dossier)).not.toContain("huda@example.com");
  });
});

describe("revealMemberContact", () => {
  it("returns contact one member at a time and writes an audit row without the contact", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await insertMember(t, "amira@example.com", {
      mobile: "+971501234589",
    });
    const result = await asAdmin.mutation(
      api.admin.members.revealMemberContact,
      { memberId },
    );
    expect(result).toEqual({
      ok: true,
      email: "amira@example.com",
      mobile: "+971501234589",
    });
    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    const reveal = audits.find((a) => a.action === "revealMemberContact");
    expect(reveal).toBeDefined();
    expect(reveal?.actor).toBe(ADMIN_EMAIL);
    expect(reveal?.target_id).toBe(memberId);
    expect(reveal?.after_summary ?? "").not.toContain("amira@example.com");
    expect(reveal?.after_summary ?? "").not.toContain("+971");
  });
});

describe("changeMemberStatus: legal transition matrix", () => {
  const LEGAL: Array<["active" | "dormant" | "suspended", "active" | "dormant" | "suspended"]> = [
    ["active", "dormant"],
    ["dormant", "active"],
    ["active", "suspended"],
    ["dormant", "suspended"],
    ["suspended", "active"],
  ];

  it("every legal transition passes and is audited with before/after", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    for (const [from, to] of LEGAL) {
      const memberId = await insertMember(t, `${from}-${to}@example.com`, {
        lifecycle_state: from,
      });
      const result = await asAdmin.mutation(
        api.admin.members.changeMemberStatus,
        { memberId, to, reason: "operational review" },
      );
      expect(result).toEqual({ ok: true, lifecycle_state: to });
      const member = await t.run(async (ctx) => ctx.db.get(memberId));
      expect(member?.lifecycle_state).toBe(to);
      const audits = await t.run(async (ctx) =>
        ctx.db.query("auditLog").collect(),
      );
      const row = audits.find(
        (a) => a.action === "changeMemberStatus" && a.target_id === memberId,
      );
      expect(row?.before_summary).toContain(`lifecycle_state=${from}`);
      expect(row?.after_summary).toContain(`lifecycle_state=${to}`);
    }
  });

  it("the reason is kept as an admin note, never in the immutable audit summary (Gate 4 round 12)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await insertMember(t, "reasoned@example.com", {
      lifecycle_state: "active",
    });
    await asAdmin.mutation(api.admin.members.changeMemberStatus, {
      memberId,
      to: "suspended",
      reason: "conduct report upheld by the committee",
    });
    // The raw reason is NOT in the audit summary...
    const audits = await t.run(async (ctx) => ctx.db.query("auditLog").collect());
    const row = audits.find(
      (a) => a.action === "changeMemberStatus" && a.target_id === memberId,
    );
    expect(row?.after_summary).toBe("lifecycle_state=suspended reason_present=true");
    expect(row?.after_summary ?? "").not.toContain("conduct report");
    // ...it lives on an admin note, in context, for the dossier.
    const notes = await asAdmin.query(api.admin.members.listMemberNotes, {
      memberId,
    });
    expect(notes.some((n) => n.text.includes("conduct report upheld"))).toBe(
      true,
    );
  });

  it("illegal transitions are refused and nothing changes", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    // suspended -> dormant is not in the machine.
    const suspendedId = await insertMember(t, "s@example.com", {
      lifecycle_state: "suspended",
    });
    expect(
      await asAdmin.mutation(api.admin.members.changeMemberStatus, {
        memberId: suspendedId,
        to: "dormant",
        reason: "no",
      }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    // Same-state is refused.
    const activeId = await insertMember(t, "a@example.com");
    expect(
      await asAdmin.mutation(api.admin.members.changeMemberStatus, {
        memberId: activeId,
        to: "active",
        reason: "no",
      }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    // Pre-active states are not admin-movable from here.
    const pendingId = await insertMember(t, "p@example.com", {
      lifecycle_state: "claim_pending",
    });
    expect(
      await asAdmin.mutation(api.admin.members.changeMemberStatus, {
        memberId: pendingId,
        to: "active",
        reason: "no",
      }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    const unchanged = await t.run(async (ctx) => ctx.db.get(pendingId));
    expect(unchanged?.lifecycle_state).toBe("claim_pending");
  });

  it("requires a non-empty reason", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await insertMember(t, "r@example.com");
    expect(
      await asAdmin.mutation(api.admin.members.changeMemberStatus, {
        memberId,
        to: "dormant",
        reason: "   ",
      }),
    ).toEqual({ ok: false, error: "validation" });
  });
});

describe("admin notes", () => {
  it("notes are attributed to the admin; the audit row never carries the text", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const memberId = await insertMember(t, "amira@example.com");
    const noteText = "Spoke to her about the Dubai meetup, very engaged.";
    const added = await asAdmin.mutation(api.admin.members.addMemberNote, {
      memberId,
      text: noteText,
    });
    expect(added.ok).toBe(true);
    const notes = await asAdmin.query(api.admin.members.listMemberNotes, {
      memberId,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].author).toBe(ADMIN_EMAIL);
    expect(notes[0].text).toBe(noteText);
    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    const row = audits.find((a) => a.action === "addMemberNote");
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain("Dubai meetup");
    // Empty note refused.
    expect(
      await asAdmin.mutation(api.admin.members.addMemberNote, {
        memberId,
        text: "  ",
      }),
    ).toEqual({ ok: false, error: "validation" });
  });
});

describe("certificates admin", () => {
  it("issuing a membership certificate notifies the member once", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, "amira@example.com", {
      name: "Amira Al Farsi",
    });
    const first = await asMember.mutation(
      api.certificates.ensureMyMembershipCertificate,
      {},
    );
    expect(first.ok).toBe(true);
    // Idempotent re-run: no second notification.
    await asMember.mutation(api.certificates.ensureMyMembershipCertificate, {});
    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    const issued = notifications.filter((n) => n.type === "certificate_issued");
    expect(issued).toHaveLength(1);
    expect(issued[0].href).toBe("/portal");
  });

  it("revoke / re-issue: the decided supersedes chain with honest public statuses", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, "amira@example.com", {
      name: "Amira Al Farsy",
    });
    const issued = await asMember.mutation(
      api.certificates.ensureMyMembershipCertificate,
      {},
    );
    const oldToken = issued.verify_token as string;
    const asAdmin = await signIn(t, ADMIN_EMAIL);

    const listed = await asAdmin.query(
      api.admin.certificates.listCertificates,
      {},
    );
    const oldRow = listed.find((c) => c.recipient_name === "Amira Al Farsy");
    expect(oldRow).toBeDefined();
    expect(oldRow?.status).toBe("valid");

    // Re-issue with the corrected name.
    const reissued = await asAdmin.mutation(
      api.admin.certificates.reissueCertificate,
      {
        certificateId: oldRow!.certificateId,
        correctedName: "Amira Al Farsi",
      },
    );
    expect(reissued.ok).toBe(true);
    const newId = (reissued as { ok: true; newCertificateId: Id<"certificates"> })
      .newCertificateId;
    const [oldCert, newCert] = await t.run(async (ctx) => [
      await ctx.db.get(oldRow!.certificateId),
      await ctx.db.get(newId),
    ]);
    expect(oldCert?.status).toBe("superseded");
    expect(newCert?.status).toBe("valid");
    expect(newCert?.supersedes_id).toBe(oldRow!.certificateId);
    expect(newCert?.recipient_name).toBe("Amira Al Farsi");
    expect(newCert?.membership_number).toBe(oldCert?.membership_number);
    expect(newCert?.is_founding).toBe(oldCert?.is_founding);
    expect(newCert?.verify_token).not.toBe(oldToken);

    // The public verification page tells the truth for BOTH tokens.
    const oldPublic = await t.query(api.certificates.getCertificateByToken, {
      token: oldToken,
    });
    expect(oldPublic?.status).toBe("superseded");
    const newPublic = await t.query(api.certificates.getCertificateByToken, {
      token: newCert!.verify_token,
    });
    expect(newPublic?.status).toBe("valid");

    // The member is told her corrected certificate is ready.
    const notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(
      notifications.some(
        (n) =>
          n.type === "certificate_issued" &&
          n.title === "Your corrected certificate is ready",
      ),
    ).toBe(true);

    // A superseded certificate cannot be corrected again or revoked.
    expect(
      await asAdmin.mutation(api.admin.certificates.reissueCertificate, {
        certificateId: oldRow!.certificateId,
        correctedName: "Another Name",
      }),
    ).toEqual({ ok: false, error: "ineligible" });
    expect(
      await asAdmin.mutation(api.admin.certificates.revokeCertificate, {
        certificateId: oldRow!.certificateId,
        reason: "should not work",
      }),
    ).toEqual({ ok: false, error: "ineligible" });

    // Revoke the live one, with reason required; never deleted.
    expect(
      await asAdmin.mutation(api.admin.certificates.revokeCertificate, {
        certificateId: newId,
        reason: "  ",
      }),
    ).toEqual({ ok: false, error: "validation" });
    expect(
      await asAdmin.mutation(api.admin.certificates.revokeCertificate, {
        certificateId: newId,
        reason: "issued in error",
      }),
    ).toEqual({ ok: true });
    expect(
      await asAdmin.mutation(api.admin.certificates.revokeCertificate, {
        certificateId: newId,
        reason: "issued in error",
      }),
    ).toEqual({ ok: true, already: true });
    const revokedPublic = await t.query(
      api.certificates.getCertificateByToken,
      { token: newCert!.verify_token },
    );
    expect(revokedPublic?.status).toBe("revoked");
    const stillThere = await t.run(async (ctx) => ctx.db.get(newId));
    expect(stillThere).not.toBeNull();

    // Both admin writes are audited.
    const audits = await t.run(async (ctx) =>
      ctx.db.query("auditLog").collect(),
    );
    expect(audits.some((a) => a.action === "reissueCertificate")).toBe(true);
    expect(audits.some((a) => a.action === "revokeCertificate")).toBe(true);
  });

  it("non-admin callers are refused on revoke and re-issue", async () => {
    const t = convexTest(schema, modules);
    const asMember = await signIn(t, NON_ADMIN);
    const certId = await t.run(async (ctx) => {
      const memberId = await ctx.db.insert(
        "members",
        memberRow("holder@example.com"),
      );
      return ctx.db.insert("certificates", {
        member_id: memberId,
        type: "membership",
        verify_token: "tok-1",
        membership_number: 2001,
        recipient_name: "Holder Name",
        issued_at: Date.now(),
        issued_date_label: "1 July 2026",
        is_founding: true,
        status: "valid",
        template_version: "membership-2026-06",
        idempotency_key: "membership:test",
      });
    });
    expect(
      await asMember.mutation(api.admin.certificates.revokeCertificate, {
        certificateId: certId,
        reason: "nope",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
    expect(
      await asMember.mutation(api.admin.certificates.reissueCertificate, {
        certificateId: certId,
        correctedName: "Nope",
      }),
    ).toEqual({ ok: false, error: "not_authorized" });
  });

  it("re-issue enforces the full-name rule the claim path holds (Gate 4 round 9 hunt)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = await signIn(t, ADMIN_EMAIL);
    const certId = await t.run(async (ctx) => {
      const memberId = await ctx.db.insert(
        "members",
        memberRow("holder@example.com"),
      );
      return ctx.db.insert("certificates", {
        member_id: memberId,
        type: "membership",
        verify_token: "tok-reissue",
        membership_number: 2001,
        recipient_name: "Holder Name",
        issued_at: Date.now(),
        issued_date_label: "1 July 2026",
        is_founding: true,
        status: "valid",
        template_version: "membership-2026-06",
        idempotency_key: "membership:reissue-test",
      });
    });
    // A single word (a dropped family name) is refused - the corrected name
    // prints on the public verify page, so it holds the same rule as claim.
    expect(
      await asAdmin.mutation(api.admin.certificates.reissueCertificate, {
        certificateId: certId,
        correctedName: "Sara",
      }),
    ).toEqual({ ok: false, error: "validation" });
    // An over-long run is refused too (claim caps at 90).
    expect(
      await asAdmin.mutation(api.admin.certificates.reissueCertificate, {
        certificateId: certId,
        correctedName: `Sara ${"x".repeat(90)}`,
      }),
    ).toEqual({ ok: false, error: "validation" });
    // The original certificate is untouched by the refusals.
    const still = await t.run(async (ctx) => ctx.db.get(certId));
    expect(still!.status).toBe("valid");
    expect(still!.recipient_name).toBe("Holder Name");
    // A proper full name is accepted.
    expect(
      (
        await asAdmin.mutation(api.admin.certificates.reissueCertificate, {
          certificateId: certId,
          correctedName: "Sara Haddad",
        })
      ).ok,
    ).toBe(true);
  });
});
