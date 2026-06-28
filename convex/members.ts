import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { action, internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { writeAudit } from "./lib/audit";
import { deriveAgeBlock } from "./lib/age";
import { evaluateMemberLane } from "./lib/memberLane";

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

type JoinResult = { ok: false; error: "validation" } | CreateResult;

// §7 submitJoin: the public Join action. Verifies the human (Turnstile) at the
// boundary, then delegates the member/consent writes to an internal mutation.
// Returns the §7.1 result envelope.
export const submitJoin = action({
  args: {
    name: v.string(),
    email: v.string(),
    careerStageAnswer: v.string(),
    genderAnswer: v.union(v.literal("female"), v.literal("male")),
    dobAnswer: v.optional(v.string()),
    consents: consentArgs,
    turnstileToken: v.string(),
  },
  handler: async (ctx, args): Promise<JoinResult> => {
    if (!args.consents.terms) {
      return { ok: false, error: "validation" } as const;
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

export const createPendingMember = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    careerStageAnswer: v.string(),
    genderAnswer: v.union(v.literal("female"), v.literal("male")),
    dobAnswer: v.optional(v.string()),
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
    await insertConsent(ctx, memberId, "terms_privacy", args.consents.terms, now);
    await insertConsent(ctx, memberId, "marketing", args.consents.marketing, now);
    await insertConsent(ctx, memberId, "pipeline", args.consents.pipeline, now);

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

// §7 writeConsent: append a new consent row (settings changes after join).
export const writeConsent = mutation({
  args: {
    memberId: v.id("members"),
    type: v.union(
      v.literal("terms_privacy"),
      v.literal("marketing"),
      v.literal("pipeline"),
    ),
    value: v.boolean(),
    source: v.union(v.literal("join"), v.literal("claim"), v.literal("settings")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const consentId = await insertConsent(
      ctx,
      args.memberId,
      args.type,
      args.value,
      now,
      args.source,
    );
    await writeAudit(ctx, {
      actor: args.memberId,
      role: "member",
      action: "writeConsent",
      target_id: args.memberId,
      after_summary: `${args.type}=${args.value}`,
      source: "member",
    });
    return { ok: true, consentId } as const;
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
