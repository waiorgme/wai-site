// SEC-7: @convex-dev/auth is pinned exactly in package.json (0.0.x pre-release;
// magic-link single-use, expiry and session integrity all live inside it, so
// upgrades are deliberate, reviewed events, never a floating caret).
import Resend from "@auth/core/providers/resend";
import { Resend as ResendAPI } from "resend";
import { ConvexError } from "convex/values";
import { convexAuth } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { confirmEmailForMember } from "./lib/activation";
import { consumeKey } from "./rateLimit";
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
// It runs inside the auth:store "createVerificationCode" MUTATION, before the
// library deletes and replaces the stored code: a throw here aborts that whole
// transaction, so an over-limit request can never invalidate a member's
// already-emailed link (the Codex Gate 4 blocker). Blocks throw
// RATE_LIMITED_MARKER, which the client maps to plain-language "wait and
// retry" copy. Limits live in convex/lib/rateLimit.ts.
const enforceSendLimits = async (
  ctx: MutationCtx,
  email: string,
): Promise<void> => {
  const checks: Array<{ key: string; rule: RateLimitRule }> = [
    { key: `signin15m:${email}`, rule: PER_EMAIL_SHORT },
    { key: `signin24h:${email}`, rule: PER_EMAIL_DAY },
    { key: "signin24h:global", rule: GLOBAL_DAY },
  ];
  for (const { key, rule } of checks) {
    const res = await consumeKey(ctx, key, rule);
    if (!res.ok) {
      // ConvexError, not Error: plain Error messages are redacted to "Server
      // Error" on production deployments, so the client would never see the
      // marker and could not show the plain-language wait-and-retry copy.
      throw new ConvexError(RATE_LIMITED_MARKER);
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

// Sends the actual email. Rate limiting does NOT live here: by the time the
// runtime calls sendVerificationRequest, the library has already deleted and
// replaced the stored verification code (signIn.js calls
// callCreateVerificationCode first), so a throw at this stage would leave a
// member's live link invalidated without a replacement. The limits are
// enforced in afterUserCreatedOrUpdated below, inside that same transaction.
WaiMagicLink.sendVerificationRequest = (async ({
  identifier: email,
  url,
  provider,
}: {
  identifier: string;
  url: string;
  provider: { apiKey?: string };
}) => {
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
    // Runs inside the auth:store mutation. Two jobs:
    // 1. SEC-2 rate limits. `type === "email"` means "a sign-in email is about
    //    to be sent": this callback fires BEFORE the library deletes and
    //    replaces the stored verification code, in the SAME transaction, so an
    //    over-limit throw rolls everything back and the member's existing link
    //    keeps working. (`type === "verification"` is link redemption; it is
    //    never rate limited here.)
    // 2. Link the auth user to the member at creation (matched by email). User
    //    creation happens when signIn is initiated, BEFORE the email is
    //    verified, so we only link here; we do NOT advance the lifecycle.
    async afterUserCreatedOrUpdated(baseCtx, { userId, type, profile }) {
      // The auth callback's ctx is generically typed; cast to our app's
      // MutationCtx so the members schema + indexes are known.
      const ctx = baseCtx as unknown as MutationCtx;
      if (type === "email" && typeof profile.email === "string") {
        await enforceSendLimits(ctx, profile.email.toLowerCase());
      }
      const member = await memberForUser(ctx, userId);
      if (member !== null && member.userId === undefined) {
        await ctx.db.patch(member._id, { userId });
      }
    },
    // Fires only on actual authentication - after the magic link is verified and
    // just before the session is created. This is the real "email verified"
    // signal, so the lifecycle advances here (§6). The transition itself lives
    // in lib/activation.ts so the funnel wiring stays testable.
    async beforeSessionCreation(baseCtx, { userId }) {
      const ctx = baseCtx as unknown as MutationCtx;
      const member = await memberForUser(ctx, userId);
      if (member === null) {
        return;
      }
      await confirmEmailForMember(ctx, member);
    },
  },
});
