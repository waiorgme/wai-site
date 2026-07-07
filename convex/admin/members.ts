import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAdmin } from "../lib/adminAuth";
import { maskName } from "../lib/adminMask";
import { writeAudit } from "../lib/audit";
import { currentStanding } from "../lib/standing";

// Members admin (panel-experience spec §F13-14). Every function is gated by
// requireAdmin (deny-by-default, Stage 0 §3); every write returns the
// §7.1 envelope and appends the mandatory §8 audit row with PII-free
// summaries. The list is a review surface, not a member-data browser: rows
// never carry an email; contact is masked on the dossier and only leaves the
// server through the audited one-at-a-time revealMemberContact (the
// claim-queue precedent). NO bulk actions, NO export: export stays the gated
// DataRequest path.

const PAGE_SIZE = 50;

type Standing = "member" | "active_member" | "ambassador" | "leadership_circle";

const lifecycleArg = v.union(
  v.literal("email_unverified"),
  v.literal("consent_pending"),
  v.literal("pending_guardian"),
  v.literal("claim_pending"),
  v.literal("pending_review"),
  v.literal("active"),
  v.literal("dormant"),
  v.literal("suspended"),
  v.literal("erasure_requested"),
  v.literal("erasure_in_progress"),
  v.literal("archived"),
);

const laneArg = v.union(
  v.literal("standard"),
  v.literal("minor"),
  v.literal("ally"),
  v.literal("restricted_unknown"),
);

const LIFECYCLE_STATES = [
  "email_unverified",
  "consent_pending",
  "pending_guardian",
  "claim_pending",
  "pending_review",
  "active",
  "dormant",
  "suspended",
  "erasure_requested",
  "erasure_in_progress",
  "archived",
] as const;

const hasText = (s: string | undefined): boolean =>
  s !== undefined && s !== "";
const hasItems = (a: ReadonlyArray<string> | undefined): boolean =>
  a !== undefined && a.length > 0;

// Profile completeness for the admin list (display only, never a gate).
// Formula: the five canonical isProfileComplete inputs (name, photo, career
// stage, function area, country of residence) carry 60 percent at 12 each;
// the depth groups carry 10 each: bio, experience (any of years band, current
// job title, current employer, sectors), qualifications (any of certifications,
// highest qualification, field of study, institution), looking_for.
const completenessPct = (m: Doc<"members">): number => {
  let pct = 0;
  if (hasText(m.name)) pct += 12;
  if (m.photo_storage_id !== undefined) pct += 12;
  if (hasText(m.career_stage_answer)) pct += 12;
  if (hasText(m.function_area)) pct += 12;
  if (hasText(m.country_of_residence)) pct += 12;
  if (hasText(m.bio)) pct += 10;
  if (
    hasText(m.years_in_aviation) ||
    hasText(m.current_job_title) ||
    hasText(m.current_employer) ||
    hasItems(m.sectors)
  ) {
    pct += 10;
  }
  if (
    hasItems(m.certifications) ||
    hasText(m.highest_qualification) ||
    hasText(m.field_of_study) ||
    hasText(m.institution)
  ) {
    pct += 10;
  }
  if (hasItems(m.looking_for)) pct += 10;
  return pct;
};

// "member since" stays truthful across the migration: the legacy join date
// wins when present, else the row's creation date.
const joinedLabel = (m: Doc<"members">): string =>
  m.original_joined_at ?? new Date(m.created_at).toISOString().slice(0, 10);

// Contact stays masked on admin read surfaces (§8 PII-minimisation, the
// adminMask idiom). The full address or number only leaves the server through
// the audited revealMemberContact below, one member at a time.
const maskEmail = (email: string): string => {
  const at = email.indexOf("@");
  if (at <= 0) {
    return "***";
  }
  return `${email[0]}***@${email.slice(at + 1)}`;
};
const maskMobile = (mobile: string): string => {
  const digits = mobile.replace(/\D/g, "");
  return digits.length < 2 ? "***" : `*** ${digits.slice(-2)}`;
};

export type MemberListRow = {
  memberId: Id<"members">;
  name: string;
  lifecycle_state: Doc<"members">["lifecycle_state"];
  member_lane: Doc<"members">["member_lane"];
  standing: Standing;
  country_of_residence: string | null;
  joined: string;
  completeness_pct: number;
};

export type MemberListResult = {
  rows: MemberListRow[];
  page: number;
  page_count: number;
  total: number;
  lifecycle_counts: Record<string, number>;
};

export const listMembers = query({
  args: {
    lifecycle: v.optional(lifecycleArg),
    lane: v.optional(laneArg),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MemberListResult> => {
    await requireAdmin(ctx);
    // Full scan is deliberate: the filter chips need counts across every
    // lifecycle state whatever filter is active, and the member base is ~1.3k
    // at launch. Revisit with .paginate() if that assumption breaks.
    const all = await ctx.db.query("members").collect();
    const needle = (args.search ?? "").trim().toLowerCase();
    // Search matches name OR email SERVER-side; the email itself never
    // reaches the browser (rows below carry no email key).
    const searched = all.filter((m) => {
      if (args.lane !== undefined && m.member_lane !== args.lane) {
        return false;
      }
      if (needle === "") {
        return true;
      }
      return (
        m.name.toLowerCase().includes(needle) ||
        m.email.toLowerCase().includes(needle)
      );
    });
    const lifecycle_counts: Record<string, number> = {};
    for (const state of LIFECYCLE_STATES) {
      lifecycle_counts[state] = 0;
    }
    for (const m of searched) {
      lifecycle_counts[m.lifecycle_state] += 1;
    }
    const filtered =
      args.lifecycle === undefined
        ? searched
        : searched.filter((m) => m.lifecycle_state === args.lifecycle);
    filtered.sort((a, b) => b.created_at - a.created_at);
    const total = filtered.length;
    const page_count = Math.max(1, Math.ceil(total / PAGE_SIZE));
    // Clamped to the real page count: if rows shrink reactively while the
    // admin sits on a later page, she lands on the last page instead of an
    // empty view over a contradictory count strip.
    const page = Math.min(Math.max(1, Math.floor(args.page ?? 1)), page_count);
    const start = (page - 1) * PAGE_SIZE;
    const rows = filtered.slice(start, start + PAGE_SIZE).map((m) => ({
      memberId: m._id,
      name: m.name,
      lifecycle_state: m.lifecycle_state,
      member_lane: m.member_lane,
      standing: currentStanding(m),
      country_of_residence: m.country_of_residence ?? null,
      joined: joinedLabel(m),
      completeness_pct: completenessPct(m),
    }));
    return {
      rows,
      page,
      page_count,
      total,
      lifecycle_counts,
    };
  },
});

export type MemberDossier = {
  memberId: Id<"members">;
  name: string;
  masked_email: string;
  masked_mobile: string | null;
  source: "new_signup" | "migrated";
  joined: string;
  membership_number: number | null;
  lifecycle_state: Doc<"members">["lifecycle_state"];
  member_lane: Doc<"members">["member_lane"];
  standing: Standing;
  completeness_pct: number;
  photo_url: string | null;
  profile: {
    identity: { headline: string; bio: string };
    background: {
      nationality: string;
      country_of_residence: string;
      career_stage_answer: string;
    };
    experience: {
      function_area: string;
      role: string;
      second_function_area: string;
      second_role: string;
      years_in_aviation: string;
      current_job_title: string;
      current_employer: string;
      sectors: string[];
    };
    qualifications: {
      certifications: string[];
      certifications_other: string;
      highest_qualification: string;
      field_of_study: string;
      institution: string;
    };
    looking_for: string[];
  };
  standing_history: Array<{
    from_standing: string;
    to_standing: string;
    reason: string;
    timestamp: number;
  }>;
  consents: Array<{
    type: "terms_privacy" | "marketing" | "pipeline";
    value: boolean;
    policy_version: string;
    source: "join" | "claim" | "settings";
    timestamp: number;
  }>;
  certificates: Array<{
    certificateId: Id<"certificates">;
    status: "valid" | "superseded" | "revoked";
    membership_number: number;
    issued_date_label: string;
    is_founding: boolean;
  }>;
  registrations: Array<{
    registrationId: Id<"eventRegistrations">;
    event_title: string;
    state: Doc<"eventRegistrations">["state"];
    starts_at: number | null;
  }>;
  applications: Array<{
    applicationId: Id<"opportunityApplications">;
    opportunity_title: string;
    state: Doc<"opportunityApplications">["state"];
    created_at: number;
  }>;
  notes: Array<{
    noteId: Id<"adminNotes">;
    author: string;
    text: string;
    created_at: number;
  }>;
  // Spec F14: recent audit rows for this member. Summaries are PII-free by
  // the §8 server contract, so nothing extra is masked here.
  recent_audit: Array<{
    action: string;
    actor: string;
    timestamp: number;
    after_summary: string | null;
  }>;
  guardian: {
    consent_state: "not_required" | "pending" | "confirmed";
    masked_guardian_name: string | null;
    confirmation_state: "pending" | "confirmed" | "expired" | null;
  } | null;
};

// The full dossier MINUS contact: email and mobile are masked here; the raw
// values only come back from the audited revealMemberContact.
export const getMemberAdmin = query({
  args: { memberId: v.id("members") },
  handler: async (ctx, args): Promise<MemberDossier | null> => {
    await requireAdmin(ctx);
    const member = await ctx.db.get(args.memberId);
    if (member === null) {
      return null;
    }

    const photo_url = member.photo_storage_id
      ? await ctx.storage.getUrl(member.photo_storage_id)
      : null;

    const history = await ctx.db
      .query("standingHistory")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .order("desc")
      .collect();

    // Consents summary: the LATEST record per type, so "she declined" and
    // "never asked" stay distinguishable (absent type = never asked).
    const consentTypes = ["terms_privacy", "marketing", "pipeline"] as const;
    const consents: MemberDossier["consents"] = [];
    for (const type of consentTypes) {
      const latest = await ctx.db
        .query("consentRecords")
        .withIndex("by_member_type_time", (q) =>
          q.eq("member_id", member._id).eq("type", type),
        )
        .order("desc")
        .first();
      if (latest !== null) {
        consents.push({
          type,
          value: latest.value,
          policy_version: latest.policy_version,
          source: latest.source,
          timestamp: latest.timestamp,
        });
      }
    }

    const certs = await ctx.db
      .query("certificates")
      .withIndex("by_member", (q) => q.eq("member_id", member._id))
      .collect();
    certs.sort((a, b) => b.issued_at - a.issued_at);
    const validCert = certs.find((c) => c.status === "valid");

    const regs = await ctx.db
      .query("eventRegistrations")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .order("desc")
      .collect();
    const registrations: MemberDossier["registrations"] = [];
    for (const r of regs) {
      const ev = await ctx.db.get(r.event_id);
      registrations.push({
        registrationId: r._id,
        event_title: ev?.title ?? "(removed)",
        state: r.state,
        starts_at: ev?.starts_at ?? null,
      });
    }

    const apps = await ctx.db
      .query("opportunityApplications")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .order("desc")
      .collect();
    const applications: MemberDossier["applications"] = [];
    for (const a of apps) {
      const opp = await ctx.db.get(a.opportunity_id);
      applications.push({
        applicationId: a._id,
        opportunity_title: opp?.title ?? "(removed)",
        state: a.state,
        created_at: a.created_at,
      });
    }

    const noteRows = await ctx.db
      .query("adminNotes")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .order("desc")
      .collect();

    const auditRows = await ctx.db
      .query("auditLog")
      .withIndex("by_target_time", (q) => q.eq("target_id", member._id))
      .order("desc")
      .take(15);

    // Guardian state for minors (and any row with a guardian record): state
    // plus a masked guardian name; the guardian's email never appears here.
    let guardian: MemberDossier["guardian"] = null;
    if (member.guardian_consent_state !== "not_required") {
      const guardianRows = await ctx.db
        .query("guardianConsents")
        .withIndex("by_member", (q) => q.eq("member_id", member._id))
        .collect();
      guardianRows.sort((a, b) => b.timestamp - a.timestamp);
      const latest = guardianRows[0];
      guardian = {
        consent_state: member.guardian_consent_state,
        masked_guardian_name:
          latest === undefined ? null : maskName(latest.guardian_name),
        confirmation_state: latest?.confirmation_state ?? null,
      };
    }

    return {
      memberId: member._id,
      name: member.name,
      masked_email: maskEmail(member.email),
      masked_mobile:
        member.mobile === undefined ? null : maskMobile(member.mobile),
      source: member.source,
      joined: joinedLabel(member),
      membership_number: validCert?.membership_number ?? null,
      lifecycle_state: member.lifecycle_state,
      member_lane: member.member_lane,
      standing: currentStanding(member),
      completeness_pct: completenessPct(member),
      photo_url,
      profile: {
        identity: {
          headline: member.headline ?? "",
          bio: member.bio ?? "",
        },
        background: {
          nationality: member.nationality ?? "",
          country_of_residence: member.country_of_residence ?? "",
          career_stage_answer: member.career_stage_answer ?? "",
        },
        experience: {
          function_area: member.function_area ?? "",
          role: member.role ?? "",
          second_function_area: member.second_function_area ?? "",
          second_role: member.second_role ?? "",
          years_in_aviation: member.years_in_aviation ?? "",
          current_job_title: member.current_job_title ?? "",
          current_employer: member.current_employer ?? "",
          sectors: member.sectors ?? [],
        },
        qualifications: {
          certifications: member.certifications ?? [],
          certifications_other: member.certifications_other ?? "",
          highest_qualification: member.highest_qualification ?? "",
          field_of_study: member.field_of_study ?? "",
          institution: member.institution ?? "",
        },
        looking_for: member.looking_for ?? [],
      },
      standing_history: history.map((h) => ({
        from_standing: h.from_standing,
        to_standing: h.to_standing,
        reason: h.reason,
        timestamp: h.timestamp,
      })),
      consents,
      certificates: certs.map((c) => ({
        certificateId: c._id,
        status: c.status,
        membership_number: c.membership_number,
        issued_date_label: c.issued_date_label,
        is_founding: c.is_founding,
      })),
      registrations,
      applications,
      notes: noteRows.map((n) => ({
        noteId: n._id,
        author: n.author,
        text: n.text,
        created_at: n.created_at,
      })),
      guardian,
      recent_audit: auditRows.map((row) => ({
        action: row.action,
        actor: row.actor,
        timestamp: row.timestamp,
        after_summary: row.after_summary ?? null,
      })),
    };
  },
});

// The ONE audited, per-member, deliberate reveal of contact details (mirrors
// admin/claims.ts revealContactEmail): the "deliberate, separate approval" the
// vault's no-bulk-PII rule requires. Propose-then-confirm in the UI; one
// member at a time; NO bulk variant.
export const revealMemberContact = mutation({
  args: { memberId: v.id("members") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; email: string; mobile: string | null }
    | { ok: false; error: "not_authorized" | "not_found" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const member = await ctx.db.get(args.memberId);
    if (member === null) {
      return { ok: false, error: "not_found" };
    }
    // §8 audit: member id only in the summary, never the revealed contact.
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "revealMemberContact",
      target_id: member._id,
      after_summary: `contact revealed for one member (lifecycle_state=${member.lifecycle_state})`,
      source: "admin_fallback",
    });
    return { ok: true, email: member.email, mobile: member.mobile ?? null };
  },
});

// Stage 0 §6, the admin-operable subset of the lifecycle machine:
// active <-> dormant, active|dormant -> suspended (upheld conduct report),
// suspended -> active (lifted). Erasure stays in the data-requests queue and
// nothing here reaches archived. NOTE: pausing standing while suspended (and
// resuming on lift) belongs to the recognition slice; this action moves
// lifecycle only.
const ADMIN_STATUS_TRANSITIONS: Partial<
  Record<
    Doc<"members">["lifecycle_state"],
    ReadonlyArray<"active" | "dormant" | "suspended">
  >
> = {
  active: ["dormant", "suspended"],
  dormant: ["active", "suspended"],
  suspended: ["active"],
};

export const changeMemberStatus = mutation({
  args: {
    memberId: v.id("members"),
    to: v.union(
      v.literal("active"),
      v.literal("dormant"),
      v.literal("suspended"),
    ),
    reason: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; lifecycle_state: "active" | "dormant" | "suspended" }
    | {
        ok: false;
        error:
          | "not_authorized"
          | "not_found"
          | "validation"
          | "invalid_transition";
      }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const reason = args.reason.trim();
    if (reason.length === 0) {
      return { ok: false, error: "validation" };
    }
    const member = await ctx.db.get(args.memberId);
    if (member === null) {
      return { ok: false, error: "not_found" };
    }
    const from = member.lifecycle_state;
    const allowed = ADMIN_STATUS_TRANSITIONS[from] ?? [];
    if (from === args.to || !allowed.includes(args.to)) {
      return { ok: false, error: "invalid_transition" };
    }
    await ctx.db.patch(member._id, { lifecycle_state: args.to });
    // The reason is the admin's own operational wording (spec F14 requires it
    // recorded with the change); it is bounded and the UI instructs plain
    // operational text, never member PII.
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "changeMemberStatus",
      target_id: member._id,
      before_summary: `lifecycle_state=${from}`,
      after_summary: `lifecycle_state=${args.to} reason="${reason.slice(0, 140)}"`,
      source: "admin_fallback",
    });
    return { ok: true, lifecycle_state: args.to };
  },
});

const NOTE_MAX = 2000;

// Append-only in practice: there is deliberately no edit or delete path for a
// note. The audit row records THAT a note was added, never its text (§8
// PII-free summaries); the text lives only on the adminNotes row.
export const addMemberNote = mutation({
  args: { memberId: v.id("members"), text: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; noteId: Id<"adminNotes"> }
    | { ok: false; error: "not_authorized" | "not_found" | "validation" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const text = args.text.trim();
    if (text.length === 0 || text.length > NOTE_MAX) {
      return { ok: false, error: "validation" };
    }
    const member = await ctx.db.get(args.memberId);
    if (member === null) {
      return { ok: false, error: "not_found" };
    }
    const noteId = await ctx.db.insert("adminNotes", {
      member_id: member._id,
      author: adminEmail,
      text,
      created_at: Date.now(),
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "addMemberNote",
      target_id: member._id,
      after_summary: `note added (length=${text.length})`,
      source: "admin_fallback",
    });
    return { ok: true, noteId };
  },
});

export const listMemberNotes = query({
  args: { memberId: v.id("members") },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      noteId: Id<"adminNotes">;
      author: string;
      text: string;
      created_at: number;
    }>
  > => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("adminNotes")
      .withIndex("by_member_time", (q) => q.eq("member_id", args.memberId))
      .order("desc")
      .collect();
    return rows.map((n) => ({
      noteId: n._id,
      author: n.author,
      text: n.text,
      created_at: n.created_at,
    }));
  },
});
