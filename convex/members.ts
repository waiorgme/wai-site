import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { writeAudit } from "./lib/audit";
import { ageInYears, deriveAgeBlock, isValidDob } from "./lib/age";
import { evaluateMemberLane } from "./lib/memberLane";
import { dobConflicts, namesRoughlyMatch } from "./lib/claim";
import { issueMembershipCertificate } from "./lib/certificates";
import { fullName, isValidNamePart, nameCase } from "./lib/names";
import {
  dobGate,
  isValidCareerStage,
  isValidCountry,
  isValidGuardianName,
  isValidJoinEmail,
  isValidLookingFor,
  normalizeEmail,
} from "./lib/joinValidation";
import { GLOBAL_JOIN_DAY, PER_EMAIL_JOIN_DAY } from "./lib/rateLimit";
import {
  isProfileComplete,
  validateProfileFields,
  type ProfileFields,
} from "./lib/profile";

// Current privacy-policy version stamped onto every consent row. Bump when the
// policy text changes so we can always show what a member agreed to and when.
// 2026-07-02: LEGAL-2 amendment (accurate collection list, truthful data-rights
// route) - see the vault privacy draft's changelog.
const POLICY_VERSION = "2026-07-02";

const consentArgs = v.object({
  terms: v.boolean(),
  marketing: v.boolean(),
  pipeline: v.boolean(),
});

// §7.1 result envelopes. Annotating the handlers with these breaks the circular
// type inference that arises when submitJoin references createPendingMember from
// the same module.
type CreateResult =
  | { ok: true; already: true; route: "sign_in" }
  | { ok: true; memberId: Id<"members">; lifecycle_state: "email_unverified" };

type JoinResult =
  | { ok: false; error: "validation" | "under_13" | "rate_limited" }
  | CreateResult;

// The logged-in member's own summary, keyed off the Convex Auth user id.
// Returns null when signed out or before the auth user is linked to a member.
export const getCurrentMember = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (member === null) {
      return null;
    }
    return {
      email: member.email,
      name: member.name,
      lifecycle_state: member.lifecycle_state,
      member_lane: member.member_lane,
      profile_complete: member.profile_complete ?? false,
    };
  },
});

// The logged-in member's full editable profile, for the editor form. Resolves
// the stored photo to a served URL. Returns null when signed out / unlinked.
export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (member === null) {
      return null;
    }
    const photo_url = member.photo_storage_id
      ? await ctx.storage.getUrl(member.photo_storage_id)
      : null;
    return {
      name: member.name,
      headline: member.headline ?? "",
      bio: member.bio ?? "",
      photo_url,
      nationality: member.nationality ?? "",
      country_of_residence: member.country_of_residence ?? "",
      career_stage_answer: member.career_stage_answer ?? "",
      function_area: member.function_area ?? "",
      role: member.role ?? "",
      second_function_area: member.second_function_area ?? "",
      second_role: member.second_role ?? "",
      years_in_aviation: member.years_in_aviation ?? "",
      current_job_title: member.current_job_title ?? "",
      current_employer: member.current_employer ?? "",
      sectors: member.sectors ?? [],
      certifications: member.certifications ?? [],
      certifications_other: member.certifications_other ?? "",
      highest_qualification: member.highest_qualification ?? "",
      field_of_study: member.field_of_study ?? "",
      institution: member.institution ?? "",
      looking_for: member.looking_for ?? [],
      profile_complete: member.profile_complete ?? false,
    };
  },
});

// A short-lived upload URL for the profile photo (Convex file storage). Auth'd,
// so only a signed-in member can request one.
export const generatePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not signed in");
    }
    // Require a linked member row, so only an actual member can request an
    // upload URL (not just any authenticated session).
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (member === null) {
      throw new Error("No member profile");
    }
    // Safeguarding: member surfaces open only at `active`. A pending_guardian
    // minor (or pending_review unknown-age account) cannot upload anything
    // until the human step confirms her.
    if (member.lifecycle_state !== "active") {
      throw new Error("Membership not active yet");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

// §I updateProfile: a member edits her own profile. Keyed off the auth user, so
// a member can only ever write her own row. Validates option fields at the
// boundary, recomputes profile_complete, writes the mandatory audit row.
export const updateProfile = mutation({
  args: {
    headline: v.optional(v.string()),
    bio: v.optional(v.string()),
    photo_storage_id: v.optional(v.id("_storage")),
    nationality: v.optional(v.string()),
    country_of_residence: v.optional(v.string()),
    career_stage_answer: v.optional(v.string()),
    function_area: v.optional(v.string()),
    role: v.optional(v.string()),
    second_function_area: v.optional(v.string()),
    second_role: v.optional(v.string()),
    years_in_aviation: v.optional(v.string()),
    current_job_title: v.optional(v.string()),
    current_employer: v.optional(v.string()),
    sectors: v.optional(v.array(v.string())),
    certifications: v.optional(v.array(v.string())),
    certifications_other: v.optional(v.string()),
    highest_qualification: v.optional(v.string()),
    field_of_study: v.optional(v.string()),
    institution: v.optional(v.string()),
    looking_for: v.optional(v.array(v.string())),
  },
  handler: async (ctx, fields): Promise<{ ok: boolean; profile_complete?: boolean; error?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { ok: false, error: "not_signed_in" };
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (member === null) {
      return { ok: false, error: "no_member" };
    }
    // Safeguarding: profile editing opens only at `active`. A pending_guardian
    // minor stays unusable until guardian confirmation (Under-18 decision);
    // pending_review unknown-age accounts wait for the human look.
    if (member.lifecycle_state !== "active") {
      return { ok: false, error: "not_active" };
    }

    const invalid = validateProfileFields(fields as ProfileFields);
    if (invalid !== null) {
      return { ok: false, error: `invalid:${invalid}` };
    }

    // SEC-4: validate the uploaded photo server-side before linking it. The
    // client's accept="image/*" is advisory; without this check any blob
    // (including scriptable SVG) would be served from a public URL. Raster
    // images only, 5 MB cap. Storage IDs are 128-bit unguessable, so ownership
    // binding is bounded by this validation (spec: out-of-scope note).
    if (fields.photo_storage_id !== undefined) {
      const blob = await ctx.db.system.get(fields.photo_storage_id);
      if (blob === null) {
        return { ok: false, error: "invalid:photo" };
      }
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      const type = blob.contentType ?? "";
      if (!allowed.includes(type) || blob.size > 5 * 1024 * 1024) {
        return { ok: false, error: "invalid:photo" };
      }
    }

    // SAFE-1: mentorship is not available to minors or unknown-age lanes;
    // strip those "looking for" options server-side whatever the client sent
    // (mirrors the join guard, which strips them at signup).
    if (
      fields.looking_for !== undefined &&
      (member.member_lane === "minor" ||
        member.member_lane === "restricted_unknown")
    ) {
      fields.looking_for = fields.looking_for.filter(
        (o) => !o.toLowerCase().includes("mentor"),
      );
    }

    const merged = { ...member, ...fields };
    const profile_complete = isProfileComplete(merged);

    await ctx.db.patch(member._id, { ...fields, profile_complete });

    await writeAudit(ctx, {
      actor: member.email,
      role: "member",
      action: "updateProfile",
      target_id: member._id,
      after_summary: `fields=[${Object.keys(fields).join(",")}] complete=${profile_complete}`,
      source: "member",
    });

    return { ok: true, profile_complete };
  },
});

// §7 submitJoin: the public Join action (PRD §6.2). Verifies the human
// (Turnstile + honeypot + rate limits) and every field at the boundary, then
// delegates the member/consent writes to an internal mutation. Returns the
// §7.1 result envelope.
// SEC-1: DOB is REQUIRED and validated here, server-side. The browser's
// `required` attribute is advisory only; without this check a caller could
// strip the field, land in the restricted_unknown lane, and bypass the minor
// safeguards entirely. Only the internal migration path (the 1,309 imported
// members) may create a member without a DOB.
export const submitJoin = action({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    country: v.string(),
    lookingFor: v.array(v.string()),
    careerStageAnswer: v.string(),
    genderAnswer: v.union(v.literal("female"), v.literal("male")),
    dobAnswer: v.string(),
    attestation: v.boolean(),
    guardianName: v.optional(v.string()),
    guardianEmail: v.optional(v.string()),
    consents: consentArgs,
    turnstileToken: v.string(),
    // Honeypot. Humans never see it; a filled value means a bot.
    website: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<JoinResult> => {
    const now = Date.now();

    // Honeypot: silently drop. Same shape as the duplicate-email route, so a
    // bot learns nothing; no row is written and no email is ever sent.
    if (args.website !== undefined && args.website !== "") {
      return { ok: true, already: true, route: "sign_in" } as const;
    }

    // Required declarations (PRD P0): terms+privacy and the truthful-details
    // attestation.
    if (!args.consents.terms || !args.attestation) {
      return { ok: false, error: "validation" } as const;
    }

    // Field validation at the boundary (every string validated and
    // length-capped in the validators; no free text reaches storage).
    if (!isValidNamePart(args.firstName) || !isValidNamePart(args.lastName)) {
      return { ok: false, error: "validation" } as const;
    }
    if (!isValidJoinEmail(args.email)) {
      return { ok: false, error: "validation" } as const;
    }
    if (!isValidCountry(args.country)) {
      return { ok: false, error: "validation" } as const;
    }
    if (!isValidLookingFor(args.lookingFor)) {
      return { ok: false, error: "validation" } as const;
    }
    if (!isValidCareerStage(args.careerStageAnswer)) {
      return { ok: false, error: "validation" } as const;
    }

    // DOB gate: min age 13; 13-17 requires the guardian branch (PRD §6.2).
    const gate = dobGate(args.dobAnswer, now);
    if (gate === "invalid") {
      return { ok: false, error: "validation" } as const;
    }
    if (gate === "under_13") {
      return { ok: false, error: "under_13" } as const;
    }
    if (gate === "minor") {
      const gEmail = (args.guardianEmail ?? "").trim();
      if (
        !isValidGuardianName(args.guardianName ?? "") ||
        !isValidJoinEmail(gEmail) ||
        normalizeEmail(gEmail) === normalizeEmail(args.email)
      ) {
        return { ok: false, error: "validation" } as const;
      }
    }

    // Human check FIRST: a failed Turnstile must leave no stored state at all,
    // including rate-limit rows. Otherwise five invalid-token requests could
    // lock a victim's email out of joining for a day (Codex Gate 4 blocker).
    const human = await verifyTurnstile(args.turnstileToken);
    if (!human) {
      return { ok: false, error: "validation" } as const;
    }

    // Per-source rate limiting (PRD P0): per-email and global daily caps,
    // consumed only by human-verified requests.
    const email = normalizeEmail(args.email);
    for (const { key, rule } of [
      { key: `join24h:${email}`, rule: PER_EMAIL_JOIN_DAY },
      { key: "join24h:global", rule: GLOBAL_JOIN_DAY },
    ]) {
      const res = await ctx.runMutation(internal.rateLimit.consume, {
        key,
        limit: rule.limit,
        windowMs: rule.windowMs,
      });
      if (!res.ok) {
        return { ok: false, error: "rate_limited" } as const;
      }
    }

    // Safeguarding: mentorship is not available to minors; strip those options
    // server-side whatever the client sent.
    const lookingFor =
      gate === "minor"
        ? args.lookingFor.filter((o) => !o.toLowerCase().includes("mentor"))
        : args.lookingFor;

    return await ctx.runMutation(internal.members.createPendingMember, {
      name: fullName(args.firstName, args.lastName),
      email,
      country: args.country,
      lookingFor,
      careerStageAnswer: args.careerStageAnswer,
      genderAnswer: args.genderAnswer,
      dobAnswer: args.dobAnswer,
      guardianName:
        gateIsMinor(gate) ? (args.guardianName ?? "").trim() : undefined,
      guardianEmail:
        gateIsMinor(gate) ? normalizeEmail(args.guardianEmail ?? "") : undefined,
      consents: args.consents,
    });
  },
});

const gateIsMinor = (gate: string): boolean => gate === "minor";

// Serves the PUBLIC join path only, so DOB is required here too (defence in
// depth behind submitJoin's dobGate). The 1,309 migrated members, who arrive
// without DOB by design, are created by the claim-wave import path, never
// through this mutation.
export const createPendingMember = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    country: v.optional(v.string()),
    lookingFor: v.optional(v.array(v.string())),
    careerStageAnswer: v.string(),
    genderAnswer: v.union(v.literal("female"), v.literal("male")),
    dobAnswer: v.string(),
    guardianName: v.optional(v.string()),
    guardianEmail: v.optional(v.string()),
    consents: consentArgs,
  },
  handler: async (ctx, args): Promise<CreateResult> => {
    const email = args.email.trim().toLowerCase();

    // Duplicate email → route to sign-in, never create a second Member row (§8).
    const existing = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing !== null) {
      return { ok: true, already: true, route: "sign_in" } as const;
    }

    const now = Date.now();
    const ageBlock = deriveAgeBlock(args.dobAnswer, now);
    const lane = evaluateMemberLane(
      {
        gender: args.genderAnswer,
        date_of_birth: ageBlock.date_of_birth,
        age_confidence: ageBlock.age_confidence,
      },
      now,
    );

    const memberId = await ctx.db.insert("members", {
      email,
      name: args.name,
      source: "new_signup",
      lifecycle_state: "email_unverified",
      ...ageBlock,
      gender: args.genderAnswer,
      career_stage_answer: args.careerStageAnswer,
      country_of_residence: args.country,
      looking_for: args.lookingFor,
      member_lane: lane,
      created_at: now,
    });

    // 13-17: record the guardian now (state pending). The guardian
    // confirmation email flow is the minor-certificate slice (Phase 3 §10);
    // until it confirms, the account stays unusable at pending_guardian.
    if (lane === "minor" && args.guardianName && args.guardianEmail) {
      await ctx.db.insert("guardianConsents", {
        member_id: memberId,
        guardian_name: args.guardianName,
        guardian_email: args.guardianEmail,
        confirmation_state: "pending",
        // Placeholder hash; the real token is generated when the confirmation
        // email is sent (later slice) and this row is re-keyed then.
        confirmation_token_hash: crypto.randomUUID().replace(/-/g, ""),
        timestamp: now,
      });
      // §8: guardian-consent capture is its own compliance event, distinct
      // from the join itself. No raw guardian PII in the summary.
      await writeAudit(ctx, {
        actor: email,
        role: "visitor",
        action: "captureGuardianConsent",
        target_id: memberId,
        after_summary: "guardian recorded state=pending",
        source: "system",
      });
    }

    // §4.3 Write all three consent rows at join, including explicit false rows
    // for marketing and pipeline (Codex 5).
    // SEC-5 safeguarding lane guard, join path: minors and unknown-age
    // accounts are blocked from the talent pipeline, and the pipeline is
    // women-only, so allies are ineligible too (Stage 0 §5: ally keeps the
    // two-option gender field but the women-only pipeline exclusion is
    // enforced centrally). A ticked pipeline box is FORCED to an explicit
    // false row and the refusal is audited. Same rule as writeConsent below;
    // without this the join form bypassed the guard.
    let pipelineConsent = args.consents.pipeline;
    if (pipelineConsent && lane !== "standard") {
      pipelineConsent = false;
      await writeAudit(ctx, {
        actor: email,
        role: "visitor",
        action: "writeConsent.refused",
        target_id: memberId,
        after_summary: `pipeline=true refused at join lane=${lane}`,
        source: "system",
      });
    }
    await insertConsent(ctx, memberId, "terms_privacy", args.consents.terms, now);
    await insertConsent(ctx, memberId, "marketing", args.consents.marketing, now);
    await insertConsent(ctx, memberId, "pipeline", pipelineConsent, now);

    await writeAudit(ctx, {
      actor: email,
      role: "visitor",
      action: "submitJoin",
      target_id: memberId,
      after_summary: `member created lifecycle=email_unverified lane=${lane}`,
      source: "system",
    });

    return {
      ok: true,
      memberId,
      lifecycle_state: "email_unverified",
    } as const;
  },
});

// §7 writeConsent: a member changes her OWN consent after join (settings). Keyed
// off the auth user - never a passed memberId - so one member can't write a
// consent row for another. Join/claim consent is written internally, not here.
export const writeConsent = mutation({
  args: {
    type: v.union(
      v.literal("terms_privacy"),
      v.literal("marketing"),
      v.literal("pipeline"),
    ),
    value: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { ok: false, error: "not_signed_in" };
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (member === null) {
      return { ok: false, error: "no_member" };
    }
    // Safeguarding: consent changes open only at `active` (join/claim consent
    // is written internally, never here). pending_guardian and pending_review
    // accounts stay read-only until their human step completes.
    if (member.lifecycle_state !== "active") {
      return { ok: false, error: "not_active" };
    }
    // SEC-5 safeguarding lane guard: minors and unknown-age accounts are
    // blocked from the talent pipeline, and it is women-only, so allies are
    // ineligible too (Stage 0 §5 central women-only exclusion). Only the
    // standard lane can consent INTO the pipeline. The refusal is audited;
    // no consent row is written.
    if (
      args.type === "pipeline" &&
      args.value === true &&
      member.member_lane !== "standard"
    ) {
      await writeAudit(ctx, {
        actor: member.email,
        role: "member",
        action: "writeConsent.refused",
        target_id: member._id,
        after_summary: `pipeline=true refused lane=${member.member_lane}`,
        source: "system",
      });
      return { ok: false, error: "not_permitted" };
    }
    const now = Date.now();
    await insertConsent(ctx, member._id, args.type, args.value, now, "settings");
    await writeAudit(ctx, {
      actor: member.email,
      role: "member",
      action: "writeConsent",
      target_id: member._id,
      after_summary: `${args.type}=${args.value}`,
      source: "member",
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Claim wave (Stage 0 §4.2/§7; Migration & Claim-Wave Plan Decision 1).
// The magic link has already proven EMAIL CONTROL; everything here is keyed
// off the authenticated user's email, never a caller-supplied row id.
// ---------------------------------------------------------------------------

const authedEmail = async (ctx: QueryCtx | MutationCtx): Promise<string | null> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  const user = await ctx.db.get(userId);
  const email = (user as { email?: string } | null)?.email;
  return typeof email === "string" ? email.toLowerCase() : null;
};

// What the signed-in-but-unlinked visitor may see about her own imported row.
// Deliberately minimal: her name and whether a DOB is on file. Nothing else
// leaves the server before the claim completes.
export const getMyClaimCandidate = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    | null
    | { state: "claimable"; name: string; has_dob_on_file: boolean }
    | { state: "held" }
  > => {
    const email = await authedEmail(ctx);
    if (email === null) {
      return null;
    }
    // Already a member? Then there is nothing to claim.
    const member = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (member !== null) {
      return null;
    }
    const rows = await ctx.db
      .query("importedMembers")
      .withIndex("by_normalized_email", (q) => q.eq("normalized_email", email))
      .collect();
    if (rows.length === 0) {
      return null;
    }
    const unclaimed = rows.find((r) => r.claim_state === "unclaimed");
    if (unclaimed !== undefined) {
      return {
        state: "claimable",
        name: unclaimed.name,
        has_dob_on_file: unclaimed.dob_if_known !== undefined,
      };
    }
    // suppressed_minor / conflict / claim_in_progress / claimed all get the
    // same neutral "held" so nothing sensitive is revealed.
    return { state: "held" };
  },
});

// §7 matchClaim: first login + confirm = the claim. Creates the Member row
// from the imported record, writes claim consents (explicit false rows), and
// issues the certificate with the LEGACY number.
export const matchClaim = mutation({
  args: {
    nameConfirmed: v.string(),
    dobAnswer: v.string(),
    attestation: v.boolean(),
    consents: consentArgs,
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; already?: true }
    | { ok: false; error: "not_signed_in" | "validation" | "conflict" | "held" | "minor" }
  > => {
    const email = await authedEmail(ctx);
    if (email === null) {
      return { ok: false, error: "not_signed_in" };
    }

    // Idempotency: an existing member row means the claim already happened.
    const existingMember = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existingMember !== null) {
      return { ok: true, already: true };
    }

    if (!args.consents.terms || !args.attestation) {
      return { ok: false, error: "validation" };
    }
    const now = Date.now();
    const confirmed = args.nameConfirmed.trim();
    if (
      confirmed.length < 2 ||
      confirmed.length > 90 ||
      confirmed.split(/\s+/).length > 6 ||
      !isValidDob(args.dobAnswer, now)
    ) {
      return { ok: false, error: "validation" };
    }

    const rows = await ctx.db
      .query("importedMembers")
      .withIndex("by_normalized_email", (q) => q.eq("normalized_email", email))
      .collect();
    const row = rows.find((r) => r.claim_state === "unclaimed");
    if (row === undefined) {
      const held = rows.find((r) => r.claim_state !== "unclaimed");
      return { ok: false, error: held?.claim_state === "suppressed_minor" ? "minor" : "held" };
    }

    // Safeguarding: a claimant who is under 18 NOW goes to the guardian route,
    // never auto-active, whatever the imported row says.
    if (ageInYears(args.dobAnswer, now) < 18) {
      await ctx.db.patch(row._id, { claim_state: "suppressed_minor" });
      await writeAudit(ctx, {
        actor: email,
        role: "member",
        action: "matchClaim.suppressedMinor",
        target_id: row._id,
        after_summary: "claimant is under 18; routed to guardian flow",
        source: "system",
      });
      return { ok: false, error: "minor" };
    }

    // DOB mismatch vs the record on file = conflict for a human (Stage 0 §4.2).
    if (dobConflicts(args.dobAnswer, row.dob_if_known)) {
      await ctx.db.patch(row._id, {
        claim_state: "conflict",
        conflict_reason: "dob_mismatch_at_claim",
      });
      await writeAudit(ctx, {
        actor: email,
        role: "member",
        action: "matchClaim.conflict",
        target_id: row._id,
        after_summary: "declared DOB differs from the record on file",
        source: "system",
      });
      return { ok: false, error: "conflict" };
    }

    const name = nameCase(args.nameConfirmed);
    const gender = row.gender ?? "female";
    const ageBlock = {
      date_of_birth: args.dobAnswer,
      date_of_birth_source: "self_declared" as const,
      age_confidence: "declared" as const,
      minor_until: undefined,
      guardian_consent_state: "not_required" as const,
    };
    const lane = evaluateMemberLane(
      {
        gender,
        date_of_birth: ageBlock.date_of_birth,
        age_confidence: ageBlock.age_confidence,
      },
      now,
    );

    const memberId = await ctx.db.insert("members", {
      email,
      name,
      mobile: row.mobile,
      source: "migrated",
      lifecycle_state: "active",
      ...ageBlock,
      gender,
      nationality: row.nationality,
      country_of_residence: row.country_of_residence,
      current_job_title: row.legacy_position,
      current_employer: row.legacy_company,
      bio: row.legacy_bio,
      member_lane: lane,
      created_at: now,
      original_joined_at: row.legacy_created_at,
    });

    // Link the auth user so the session resolves to the new member row.
    const userId = await getAuthUserId(ctx);
    if (userId !== null) {
      await ctx.db.patch(memberId, { userId });
    }

    // §4.3 claim consents, explicit false rows included. Safeguarding lane
    // guard mirrors join: only standard/ally may enter the pipeline.
    const pipelineAllowed = lane === "standard" || lane === "ally";
    await insertConsent(ctx, memberId, "terms_privacy", args.consents.terms, now, "claim");
    await insertConsent(ctx, memberId, "marketing", args.consents.marketing, now, "claim");
    await insertConsent(
      ctx,
      memberId,
      "pipeline",
      pipelineAllowed ? args.consents.pipeline : false,
      now,
      "claim",
    );

    await ctx.db.patch(row._id, {
      claim_state: "claimed",
      linked_member_id: memberId,
      match_signals: {
        email: true,
        name: namesRoughlyMatch(name, row.name),
        mobile: false,
        dob: row.dob_if_known !== undefined,
      },
    });

    await writeAudit(ctx, {
      actor: email,
      role: "member",
      action: "matchClaim",
      target_id: memberId,
      after_summary: `claimed legacy row ${row.legacy_row_id} lane=${lane} lifecycle=active`,
      source: "member",
    });

    // The first win, with her own legacy number (DATA-1).
    const member = await ctx.db.get(memberId);
    if (member !== null) {
      await issueMembershipCertificate(
        ctx,
        member,
        row.legacy_membership_number,
      );
    }

    return { ok: true };
  },
});

type ConsentType = "terms_privacy" | "marketing" | "pipeline";
type ConsentSource = "join" | "claim" | "settings";

const insertConsent = async (
  ctx: MutationCtx,
  memberId: Id<"members">,
  type: ConsentType,
  value: boolean,
  timestamp: number,
  source: ConsentSource = "join",
): Promise<Id<"consentRecords">> =>
  ctx.db.insert("consentRecords", {
    member_id: memberId,
    type,
    value,
    policy_version: POLICY_VERSION,
    source,
    timestamp,
  });

// §1 Bot protection: server-side Cloudflare Turnstile verification.
const verifyTurnstile = async (token: string): Promise<boolean> => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret === undefined) {
    return false;
  }
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    },
  );
  const data = (await res.json()) as { success: boolean };
  return data.success === true;
};
