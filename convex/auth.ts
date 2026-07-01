// SEC-7: @convex-dev/auth is pinned exactly in package.json (0.0.x pre-release;
// magic-link single-use, expiry and session integrity all live inside it, so
// upgrades are deliberate, reviewed events, never a floating caret).
import Resend from "@auth/core/providers/resend";
import { Resend as ResendAPI } from "resend";
import { convexAuth } from "@convex-dev/auth/server";
import type { GenericActionCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { issueMembershipCertificate } from "./lib/certificates";
import {
  GLOBAL_DAY,
  PER_EMAIL_DAY,
  PER_EMAIL_SHORT,
  RATE_LIMITED_MARKER,
  type RateLimitRule,
} from "./lib/rateLimit";

// The member row linked to an auth user, matched by (lower-cased) email.
const memberForUser = async (
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"members"> | null> => {
  const user = await ctx.db.get(userId);
  const email = user?.email;
  if (typeof email !== "string") {
    return null;
  }
  return ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
    .unique();
};

// SEC-2: every sign-in email (join AND portal) passes through this one choke
// point, so the rate limits cannot be sidestepped by picking another form.
// Blocks throw RATE_LIMITED_MARKER, which the client maps to plain-language
// "wait and retry" copy. Limits live in convex/lib/rateLimit.ts.
const enforceSendLimits = async (
  ctx: GenericActionCtx<DataModel>,
  email: string,
): Promise<void> => {
  const checks: Array<{ key: string; rule: RateLimitRule }> = [
    { key: `signin15m:${email}`, rule: PER_EMAIL_SHORT },
    { key: `signin24h:${email}`, rule: PER_EMAIL_DAY },
    { key: "signin24h:global", rule: GLOBAL_DAY },
  ];
  for (const { key, rule } of checks) {
    const res = await ctx.runMutation(internal.rateLimit.consume, {
      key,
      limit: rule.limit,
      windowMs: rule.windowMs,
    });
    if (!res.ok) {
      throw new Error(RATE_LIMITED_MARKER);
    }
  }
};

// §1 Auth: Convex Auth, magic-link only (no passwords). §8 specifics:
// 15-minute single-use links, delivered transactionally via Resend.
const WaiMagicLink = Resend({
  id: "resend",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 15,
});

// The runtime calls sendVerificationRequest(args, ctx) — see
// @convex-dev/auth/dist/server/implementation/signIn.js — but the @auth/core
// type declares only the first parameter, hence the narrow cast below. The ctx
// gives us the deployment's mutation runner for the rate-limit buckets.
WaiMagicLink.sendVerificationRequest = (async (
  {
    identifier: email,
    url,
    provider,
  }: { identifier: string; url: string; provider: { apiKey?: string } },
  ctx: GenericActionCtx<DataModel>,
) => {
  await enforceSendLimits(ctx, email.toLowerCase());
  const resend = new ResendAPI(provider.apiKey as string);
  const { error } = await resend.emails.send({
    from: process.env.AUTH_EMAIL_FROM ?? "WAI-ME <noreply@updates.waiorg.me>",
    to: [email],
    subject: "Your WAI-ME sign-in link",
    text:
      `Sign in to WAI-ME:\n${url}\n\n` +
      `This link expires in 15 minutes and can be used once. ` +
      `If you didn't request it, you can ignore this email.`,
  });
  if (error) {
    throw new Error("Could not send sign-in link");
  }
}) as unknown as typeof WaiMagicLink.sendVerificationRequest;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [WaiMagicLink],
  callbacks: {
    // Link the auth user to the member at creation (matched by email). User
    // creation happens when signIn is initiated — BEFORE the email is verified —
    // so we only link here; we do NOT advance the lifecycle.
    async afterUserCreatedOrUpdated(baseCtx, { userId }) {
      // The auth callback's ctx is generically typed; cast to our app's
      // MutationCtx so the members schema + indexes are known.
      const ctx = baseCtx as unknown as MutationCtx;
      const member = await memberForUser(ctx, userId);
      if (member !== null && member.userId === undefined) {
        await ctx.db.patch(member._id, { userId });
      }
    },
    // Fires only on actual authentication — after the magic link is verified and
    // just before the session is created. This is the real "email verified"
    // signal, so we advance the lifecycle here (§6): minors → pending_guardian,
    // unknown age → pending_review (SEC-3: never auto-activated, a human looks
    // first), standard/ally (consents captured at join) → active.
    async beforeSessionCreation(baseCtx, { userId }) {
      const ctx = baseCtx as unknown as MutationCtx;
      const member = await memberForUser(ctx, userId);
      if (member === null || member.lifecycle_state !== "email_unverified") {
        return;
      }
      const next =
        member.member_lane === "minor"
          ? "pending_guardian"
          : member.member_lane === "restricted_unknown"
            ? "pending_review"
            : "active";
      await ctx.db.patch(member._id, { lifecycle_state: next });
      await ctx.db.insert("auditLog", {
        actor: member.email,
        role: "member",
        action: "confirmMagicLink",
        target_id: member._id,
        before_summary: "lifecycle=email_unverified",
        after_summary: `lifecycle=${next}`,
        timestamp: Date.now(),
        source: "system",
      });
      // The first win: issue the membership certificate the moment the email is
      // verified — but ONLY for members who reach `active` here. Minors get it
      // after guardian confirmation (a later slice); unknown-age accounts get it
      // after human review. Idempotent.
      if (next === "active") {
        await issueMembershipCertificate(ctx, member);
      }
    },
  },
});
