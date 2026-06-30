import Resend from "@auth/core/providers/resend";
import { Resend as ResendAPI } from "resend";
import { convexAuth } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { issueMembershipCertificate } from "./lib/certificates";

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

// §1 Auth: Convex Auth, magic-link only (no passwords). §8 specifics:
// 15-minute single-use links, delivered transactionally via Resend.
const WaiMagicLink = Resend({
  id: "resend",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 15,
  async sendVerificationRequest({ identifier: email, url, provider }) {
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
  },
});

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
    // everyone else (consents captured at join) → active.
    async beforeSessionCreation(baseCtx, { userId }) {
      const ctx = baseCtx as unknown as MutationCtx;
      const member = await memberForUser(ctx, userId);
      if (member === null || member.lifecycle_state !== "email_unverified") {
        return;
      }
      const next =
        member.member_lane === "minor" ? "pending_guardian" : "active";
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
      // verified (adults reach `active` here; minors get it after guardian
      // confirmation, a later slice). Idempotent.
      if (next === "active") {
        await issueMembershipCertificate(ctx, member);
      }
    },
  },
});
