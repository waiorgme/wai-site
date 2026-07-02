import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { writeAudit } from "./lib/audit";
import { deriveAgeBlock, isValidDob, meetsMinimumJoinAge } from "./lib/age";
import { evaluateMemberLane } from "./lib/memberLane";
import {
  isProfileComplete,
  validateProfileFields,
  type ProfileFields,
} from "./lib/profile";

// Current privacy-policy version stamped onto every consent row. Bump when the
// policy text changes so we can always show what a member agreed to and when.
const POLICY_VERSION = "2026-06-24";

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
  | { ok: false; error: "validation" | "underage" }
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

// §7 submitJoin: the public Join action. Verifies the human (Turnstile) at the
// boundary, then delegates the member/consent writes to an internal mutation.
// Returns the §7.1 result envelope.
// SEC-1: DOB is REQUIRED and validated here, server-side. The browser's
// `required` attribute is advisory only; without this check a caller could
// strip the field, land in the restricted_unknown lane, and bypass the minor
// safeguards entirely. Only the internal migration path (the 1,309 imported
// members) may create a member without a DOB.
export const submitJoin = action({
  args: {
    name: v.string(),
    email: v.string(),
    careerStageAnswer: v.string(),
    genderAnswer: v.union(v.literal("female"), v.literal("male")),
    dobAnswer: v.string(),
    consents: consentArgs,
    turnstileToken: v.string(),
  },
  handler: async (ctx, args): Promise<JoinResult> => {
    if (!args.consents.terms) {
      return { ok: false, error: "validation" } as const;
    }
    if (!isValidDob(args.dobAnswer, Date.now())) {
      return { ok: false, error: "validation" } as const;
    }
    // Vault lock: minimum joining age is 13; under-13s are never signed up as
    // their own members. Rejected BEFORE any member or consent row exists. The
    // distinct error lets the form show the decided gentle-refusal copy.
    if (!meetsMinimumJoinAge(args.dobAnswer, Date.now())) {
      return { ok: false, error: "underage" } as const;
    }
    const human = await verifyTurnstile(args.turnstileToken);
    if (!human) {
      return { ok: false, error: "validation" } as const;
    }
    return await ctx.runMutation(internal.members.createPendingMember, {
      name: args.name,
      email: args.email,
      careerStageAnswer: args.careerStageAnswer,
      genderAnswer: args.genderAnswer,
      dobAnswer: args.dobAnswer,
      consents: args.consents,
    });
  },
});

// Serves the PUBLIC join path only, so DOB is required here too (defence in
// depth behind submitJoin's checks). The 1,309 migrated members, who arrive
// without DOB by design, are created by the claim-wave import path, never
// through this mutation.
export const createPendingMember = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    careerStageAnswer: v.string(),
    genderAnswer: v.union(v.literal("female"), v.literal("male")),
    dobAnswer: v.string(),
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
      member_lane: lane,
      created_at: now,
    });

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
