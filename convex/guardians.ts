import { v } from "convex/values";
import { Resend as ResendAPI } from "resend";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { writeAudit } from "./lib/audit";
import { issueMembershipCertificate } from "./lib/certificates";
import {
  GUARDIAN_EMAIL_SUBJECT,
  renderGuardianEmail,
} from "./lib/guardianEmail";
import {
  generateGuardianToken,
  hashGuardianToken,
  isGuardianTokenExpired,
} from "./lib/guardianToken";
import { consumeKey } from "./rateLimit";
import { GLOBAL_DAY } from "./lib/rateLimit";
import { SITE } from "../site.config.mjs";

// The guardian-consent flow (Under-18 decision: a REAL confirmation step,
// never a self-ticked box). A 13-17 member verifies her email, lands at
// pending_guardian, and the guardian gets the vault's confirmation email with
// a tokened link. Confirmation is an explicit button press on that page.

// Per-member resend throttle (spec criterion 4): 1/hour, 3/day.
const RESEND_HOUR = { limit: 1, windowMs: 60 * 60 * 1000 };
const RESEND_DAY = { limit: 3, windowMs: 24 * 60 * 60 * 1000 };

// Rotate the token and reserve send budget, all in one transaction. Returns
// what the action needs to send, or a refusal it can surface. The PLAIN token
// exists only in transit between this mutation and the send action; storage
// only ever sees the hash.
export const prepareGuardianSend = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; to: string; subject: string; text: string }
    | { ok: false; reason: "not_eligible" | "rate_limited" }
  > => {
    const member = await ctx.db.get(args.memberId);
    if (
      member === null ||
      member.lifecycle_state !== "pending_guardian" ||
      member.member_lane !== "minor"
    ) {
      return { ok: false, reason: "not_eligible" };
    }
    const consent = await ctx.db
      .query("guardianConsents")
      .withIndex("by_member", (q) => q.eq("member_id", args.memberId))
      .order("desc")
      .first();
    if (consent === null || consent.confirmation_state === "confirmed") {
      return { ok: false, reason: "not_eligible" };
    }
    // Guardian emails share the Resend budget with magic links (criterion 4):
    // consume the same global daily bucket, inside this transaction so a
    // refusal leaves no side effects.
    const budget = await consumeKey(ctx, "signin24h:global", GLOBAL_DAY);
    if (!budget.ok) {
      return { ok: false, reason: "rate_limited" };
    }

    const token = generateGuardianToken();
    const now = Date.now();
    await ctx.db.patch(consent._id, {
      confirmation_token_hash: await hashGuardianToken(token),
      confirmation_state: "pending",
      token_sent_at: now,
    });
    await writeAudit(ctx, {
      actor: member.email,
      role: "system",
      action: "sendGuardianEmail",
      target_id: member._id,
      after_summary: "guardian confirmation email prepared; token rotated",
      source: "system",
    });
    const firstName = member.name.split(" ")[0];
    return {
      ok: true,
      to: consent.guardian_email,
      subject: GUARDIAN_EMAIL_SUBJECT,
      text: renderGuardianEmail({
        guardianName: consent.guardian_name,
        applicantFirstName: firstName,
        confirmUrl: `${SITE}/guardian-confirm/?token=${token}`,
      }),
    };
  },
});

// Sends the prepared email via Resend. Scheduled from the auth hook (first
// send, right when the member reaches pending_guardian) and from the member's
// resend button.
export const sendGuardianEmail = internalAction({
  args: { memberId: v.id("members") },
  handler: async (ctx, args): Promise<void> => {
    const prepared = await ctx.runMutation(
      internal.guardians.prepareGuardianSend,
      { memberId: args.memberId },
    );
    if (!prepared.ok) {
      return; // refusal already left no stored token; audited paths cover it
    }
    const resend = new ResendAPI(process.env.AUTH_RESEND_KEY as string);
    const { error } = await resend.emails.send({
      from: process.env.AUTH_EMAIL_FROM ?? "WAI-ME <noreply@updates.waiorg.me>",
      to: [prepared.to],
      subject: prepared.subject,
      text: prepared.text,
    });
    if (error) {
      throw new Error("Could not send the guardian email");
    }
  },
});

// The member's "Send it again" button on the waiting panel. Throttled
// server-side; refusals audited.
export const resendGuardianEmail = mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: boolean; error?: "not_signed_in" | "not_eligible" | "rate_limited" }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { ok: false, error: "not_signed_in" };
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (
      member === null ||
      member.lifecycle_state !== "pending_guardian" ||
      member.member_lane !== "minor"
    ) {
      return { ok: false, error: "not_eligible" };
    }
    for (const [key, rule] of [
      [`guardian1h:${member._id}`, RESEND_HOUR] as const,
      [`guardian24h:${member._id}`, RESEND_DAY] as const,
    ]) {
      const res = await consumeKey(ctx, key, rule);
      if (!res.ok) {
        await writeAudit(ctx, {
          actor: member.email,
          role: "member",
          action: "resendGuardianEmail.refused",
          target_id: member._id,
          after_summary: "resend throttled",
          source: "system",
        });
        return { ok: false, error: "rate_limited" };
      }
    }
    await ctx.scheduler.runAfter(0, internal.guardians.sendGuardianEmail, {
      memberId: member._id,
    });
    return { ok: true };
  },
});

// The confirm page's first step: what does this token point at? NEVER
// confirms anything, and reveals nothing beyond the three neutral states
// (invalid covers unknown, expired and malformed alike; no member data).
export const lookupGuardianToken = query({
  args: { token: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ state: "confirmable" | "already_confirmed" | "invalid"; applicantFirstName?: string }> => {
    if (args.token.length < 16 || args.token.length > 128) {
      return { state: "invalid" };
    }
    const hash = await hashGuardianToken(args.token);
    const consent = await ctx.db
      .query("guardianConsents")
      .withIndex("by_token_hash", (q) => q.eq("confirmation_token_hash", hash))
      .unique();
    if (consent === null) {
      return { state: "invalid" };
    }
    if (consent.confirmation_state === "confirmed") {
      return { state: "already_confirmed" };
    }
    if (
      consent.confirmation_state === "expired" ||
      consent.token_sent_at === undefined ||
      isGuardianTokenExpired(consent.token_sent_at, Date.now())
    ) {
      return { state: "invalid" };
    }
    const member = await ctx.db.get(consent.member_id);
    if (member === null) {
      return { state: "invalid" };
    }
    // The button copy names the applicant (vault email draft); a valid token
    // holder already received her first name in the email itself.
    return {
      state: "confirmable",
      applicantFirstName: member.name.split(" ")[0],
    };
  },
});

// The explicit consent press (criterion 3). One transaction: consent row
// confirmed, the member's age block upgraded to guardian_confirmed, lifecycle
// pending_guardian -> active (legal §6 transition), her certificate issued,
// everything audited. Idempotent on an already-confirmed token.
export const confirmGuardianConsent = mutation({
  args: { token: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ state: "confirmed" | "already_confirmed" | "invalid" }> => {
    if (args.token.length < 16 || args.token.length > 128) {
      return { state: "invalid" };
    }
    const hash = await hashGuardianToken(args.token);
    const consent = await ctx.db
      .query("guardianConsents")
      .withIndex("by_token_hash", (q) => q.eq("confirmation_token_hash", hash))
      .unique();
    if (consent === null) {
      return { state: "invalid" };
    }
    if (consent.confirmation_state === "confirmed") {
      return { state: "already_confirmed" };
    }
    const now = Date.now();
    if (
      consent.confirmation_state === "expired" ||
      consent.token_sent_at === undefined ||
      isGuardianTokenExpired(consent.token_sent_at, now)
    ) {
      if (consent.confirmation_state === "pending") {
        await ctx.db.patch(consent._id, { confirmation_state: "expired" });
      }
      return { state: "invalid" };
    }
    const member = await ctx.db.get(consent.member_id);
    if (member === null || member.lifecycle_state !== "pending_guardian") {
      return { state: "invalid" };
    }

    await ctx.db.patch(consent._id, { confirmation_state: "confirmed" });
    await ctx.db.patch(member._id, {
      guardian_consent_state: "confirmed",
      date_of_birth_source: "guardian_confirmed",
      age_confidence: "confirmed",
      lifecycle_state: "active",
    });
    await writeAudit(ctx, {
      actor: member.email,
      role: "system",
      action: "captureGuardianConsent.confirmed",
      target_id: member._id,
      after_summary: "guardian confirmed by token",
      source: "system",
    });
    await writeAudit(ctx, {
      actor: member.email,
      role: "system",
      action: "confirmGuardianConsent",
      target_id: member._id,
      before_summary: "lifecycle=pending_guardian",
      after_summary: "lifecycle=active",
      source: "system",
    });
    // Her first win: the youth membership certificate (Under-18 decision),
    // issued the moment the guardian confirms. Idempotent.
    const activated = await ctx.db.get(member._id);
    if (activated !== null) {
      await issueMembershipCertificate(ctx, activated);
    }
    return { state: "confirmed" };
  },
});
