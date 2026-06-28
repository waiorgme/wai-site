import Resend from "@auth/core/providers/resend";
import { Resend as ResendAPI } from "resend";
import { convexAuth } from "@convex-dev/auth/server";

// §1 Auth: Convex Auth, magic-link only (no passwords). §8 specifics:
// 15-minute single-use links, delivered transactionally via Resend.
const WaiMagicLink = Resend({
  id: "resend",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 60 * 15,
  async sendVerificationRequest({ identifier: email, url, provider }) {
    const resend = new ResendAPI(provider.apiKey as string);
    const { error } = await resend.emails.send({
      from: process.env.AUTH_EMAIL_FROM ?? "WAI-ME <onboarding@resend.dev>",
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
    // On first verified sign-in, link the auth user to the member row created at
    // join (matched by email) and advance the lifecycle per §6. Minors route to
    // pending_guardian; everyone else (consents already captured at join) to active.
    async afterUserCreatedOrUpdated(ctx, { userId, profile }) {
      const email = profile.email;
      if (typeof email !== "string") {
        return;
      }
      const member = await ctx.db
        .query("members")
        .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
        .unique();
      if (member === null) {
        return;
      }
      const patch: {
        userId?: typeof userId;
        lifecycle_state?: "pending_guardian" | "active";
      } = {};
      if (member.userId === undefined) {
        patch.userId = userId;
      }
      if (member.lifecycle_state === "email_unverified") {
        patch.lifecycle_state =
          member.member_lane === "minor" ? "pending_guardian" : "active";
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(member._id, patch);
        await ctx.db.insert("auditLog", {
          actor: email,
          role: "member",
          action: "confirmMagicLink",
          target_id: member._id,
          before_summary: `lifecycle=${member.lifecycle_state}`,
          after_summary: `lifecycle=${patch.lifecycle_state ?? member.lifecycle_state}`,
          timestamp: Date.now(),
          source: "system",
        });
      }
    },
  },
});
