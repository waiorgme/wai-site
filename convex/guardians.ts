import { v } from "convex/values";
import { Resend as ResendAPI } from "resend";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import {
  action,
  type ActionCtx,
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
  GUARDIAN_TOKEN_TTL_MS,
  generateGuardianToken,
  hashGuardianToken,
  isGuardianTokenExpired,
} from "./lib/guardianToken";
import { POLICY_VERSION } from "./lib/policy";
import { consumeKey, peekKey, releaseKey } from "./rateLimit";
import { GLOBAL_DAY } from "./lib/rateLimit";
import { SITE } from "../site.config.mjs";

// The guardian-consent flow (Under-18 decision: a REAL confirmation step,
// never a self-ticked box). A 13-17 member verifies her email, lands at
// pending_guardian, and the guardian gets the vault's confirmation email with
// a tokened link. Confirmation is an explicit button press on that page.

// Per-member resend throttle (spec criterion 4): 1/hour, 3/day.
const RESEND_HOUR = { limit: 1, windowMs: 60 * 60 * 1000 };
const RESEND_DAY = { limit: 3, windowMs: 24 * 60 * 60 * 1000 };

// Rotate the token and reserve send budget, all in one transaction; every
// refusal is audited and leaves NO side effects (nothing rotated, nothing
// consumed persists past the rollback of a thrown mutation, and refusals
// return before any write). The PLAIN token exists only in transit between
// this mutation and the send action; storage only ever sees the hash. When
// `viaMemberResend`, the member is resolved from auth (never a client id)
// and her personal throttle is consumed here, atomically with the rotation,
// so an unsent email can never burn her budget.
export const prepareGuardianSend = internalMutation({
  args: {
    memberId: v.optional(v.id("members")),
    viaMemberResend: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | {
        ok: true;
        consentId: Id<"guardianConsents">;
        memberId: Id<"members">;
        prevHash: string;
        prevSentAt?: number;
        prevState: "pending" | "expired";
        releaseMemberQuota: boolean;
        to: string;
        subject: string;
        text: string;
      }
    | { ok: false; reason: "not_eligible" | "rate_limited" }
  > => {
    let memberId = args.memberId ?? null;
    if (args.viaMemberResend === true) {
      const userId = await getAuthUserId(ctx);
      if (userId === null) {
        return { ok: false, reason: "not_eligible" };
      }
      const own = await ctx.db
        .query("members")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
      memberId = own?._id ?? null;
    }
    if (memberId === null) {
      return { ok: false, reason: "not_eligible" };
    }
    const member = await ctx.db.get(memberId);
    if (
      member === null ||
      member.lifecycle_state !== "pending_guardian" ||
      member.member_lane !== "minor"
    ) {
      if (member !== null) {
        await writeAudit(ctx, {
          actor: member.email,
          role: "system",
          action: "sendGuardianEmail.refused",
          target_id: member._id,
          after_summary: `not eligible: lifecycle=${member.lifecycle_state} lane=${member.member_lane}`,
          source: "system",
        });
      }
      return { ok: false, reason: "not_eligible" };
    }
    const consent = await ctx.db
      .query("guardianConsents")
      .withIndex("by_member", (q) => q.eq("member_id", member._id))
      .order("desc")
      .first();
    if (consent === null || consent.confirmation_state === "confirmed") {
      await writeAudit(ctx, {
        actor: member.email,
        role: "system",
        action: "sendGuardianEmail.refused",
        target_id: member._id,
        after_summary:
          consent === null ? "no guardian recorded" : "already confirmed",
        source: "system",
      });
      return { ok: false, reason: "not_eligible" };
    }
    // Rate limits, peek-first: EVERY applicable bucket is checked read-only
    // before ANY is consumed, so a refusal in one bucket never burns another
    // (member quota survives a global-cap refusal and vice versa). Guardian
    // emails share the Resend budget with magic links (criterion 4).
    const buckets: Array<{
      key: string;
      rule: { limit: number; windowMs: number };
      refusal: { action: string; role: string; summary: string };
    }> = [];
    if (args.viaMemberResend === true) {
      buckets.push(
        {
          key: `guardian1h:${member._id}`,
          rule: RESEND_HOUR,
          refusal: {
            action: "resendGuardianEmail.refused",
            role: "member",
            summary: "resend throttled",
          },
        },
        {
          key: `guardian24h:${member._id}`,
          rule: RESEND_DAY,
          refusal: {
            action: "resendGuardianEmail.refused",
            role: "member",
            summary: "resend throttled",
          },
        },
      );
    }
    buckets.push({
      key: "signin24h:global",
      rule: GLOBAL_DAY,
      refusal: {
        action: "sendGuardianEmail.refused",
        role: "system",
        summary: "global daily send cap reached",
      },
    });
    for (const bucket of buckets) {
      const res = await peekKey(ctx, bucket.key, bucket.rule);
      if (!res.ok) {
        await writeAudit(ctx, {
          actor: member.email,
          role: bucket.refusal.role,
          action: bucket.refusal.action,
          target_id: member._id,
          after_summary: bucket.refusal.summary,
          source: "system",
        });
        return { ok: false, reason: "rate_limited" };
      }
    }
    for (const bucket of buckets) {
      await consumeKey(ctx, bucket.key, bucket.rule);
    }

    const token = generateGuardianToken();
    const now = Date.now();
    await ctx.db.patch(consent._id, {
      confirmation_token_hash: await hashGuardianToken(token),
      confirmation_state: "pending",
      token_sent_at: now,
    });
    // Persist expiry without waiting for anyone to press anything: a
    // scheduled marker flips the row to `expired` when this token times out
    // (a later rotation writes a new hash, which the marker checks).
    await ctx.scheduler.runAfter(
      GUARDIAN_TOKEN_TTL_MS,
      internal.guardians.expireGuardianToken,
      { consentId: consent._id, tokenHash: await hashGuardianToken(token) },
    );
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
      consentId: consent._id,
      memberId: member._id,
      prevHash: consent.confirmation_token_hash,
      prevSentAt: consent.token_sent_at,
      prevState: consent.confirmation_state as "pending" | "expired",
      releaseMemberQuota: args.viaMemberResend === true,
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

// Compensation for a failed Resend call: restore the previous token so the
// last link that WAS emailed keeps working, and audit the failure.
export const rollbackGuardianSend = internalMutation({
  args: {
    consentId: v.id("guardianConsents"),
    memberId: v.id("members"),
    prevHash: v.string(),
    prevSentAt: v.optional(v.number()),
    prevState: v.union(v.literal("pending"), v.literal("expired")),
    releaseMemberQuota: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    const consent = await ctx.db.get(args.consentId);
    if (consent === null || consent.confirmation_state !== "pending") {
      return;
    }
    // Restore EVERYTHING the prepare changed, including the state: a failed
    // send must never resurrect an expired row as pending.
    await ctx.db.patch(args.consentId, {
      confirmation_token_hash: args.prevHash,
      token_sent_at: args.prevSentAt,
      confirmation_state: args.prevState,
    });
    // A send that never happened must not burn the member's resend quota.
    if (args.releaseMemberQuota) {
      await releaseKey(ctx, `guardian1h:${args.memberId}`, RESEND_HOUR);
      await releaseKey(ctx, `guardian24h:${args.memberId}`, RESEND_DAY);
    }
    await writeAudit(ctx, {
      actor: `guardianConsent:${args.consentId}`,
      role: "system",
      action: "sendGuardianEmail.failed",
      target_id: consent.member_id,
      after_summary: "Resend call failed; previous token restored, no email delivered",
      source: "system",
    });
  },
});

// The scheduled expiry marker (spec criterion 2: expiry is persisted, not
// just computed at read time). Only expires the exact token it was armed for,
// and verifies the CLOCK rather than trusting its own schedule (a marker that
// fires early - a rescheduled deploy, a test runtime's timer clamp - must
// never kill a live token).
export const expireGuardianToken = internalMutation({
  args: { consentId: v.id("guardianConsents"), tokenHash: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const consent = await ctx.db.get(args.consentId);
    if (
      consent === null ||
      consent.confirmation_state !== "pending" ||
      consent.confirmation_token_hash !== args.tokenHash ||
      consent.token_sent_at === undefined ||
      !isGuardianTokenExpired(consent.token_sent_at, Date.now())
    ) {
      return;
    }
    await ctx.db.patch(args.consentId, { confirmation_state: "expired" });
  },
});

// Sends the prepared email via Resend, with truthful failure handling.
// Returns what actually happened so callers never claim an unsent email.
const performGuardianSend = async (
  ctx: ActionCtx,
  memberId: Id<"members"> | undefined,
  viaMemberResend: boolean,
): Promise<"sent" | "not_eligible" | "rate_limited" | "send_failed"> => {
  const prepared = await ctx.runMutation(
    internal.guardians.prepareGuardianSend,
    { memberId, viaMemberResend },
  );
  if (!prepared.ok) {
    return prepared.reason;
  }
  const resend = new ResendAPI(process.env.AUTH_RESEND_KEY as string);
  try {
    const { error } = await resend.emails.send({
      from: process.env.AUTH_EMAIL_FROM ?? "WAI-ME <noreply@updates.waiorg.me>",
      to: [prepared.to],
      subject: prepared.subject,
      text: prepared.text,
    });
    if (error) {
      throw new Error("Resend returned an error");
    }
  } catch {
    await ctx.runMutation(internal.guardians.rollbackGuardianSend, {
      consentId: prepared.consentId,
      memberId: prepared.memberId,
      prevHash: prepared.prevHash,
      prevSentAt: prepared.prevSentAt,
      prevState: prepared.prevState,
      releaseMemberQuota: prepared.releaseMemberQuota,
    });
    return "send_failed";
  }
  return "sent";
};

// First send, scheduled from the auth hook the moment the member reaches
// pending_guardian. Failures are audited by the rollback path.
export const sendGuardianEmail = internalAction({
  args: { memberId: v.id("members") },
  handler: async (ctx, args): Promise<void> => {
    await performGuardianSend(ctx, args.memberId, false);
  },
});

// The member's "Send it again" button. A public ACTION so the reply reflects
// what actually happened: ok only after Resend accepted the email. The member
// is resolved from auth inside the transaction, never from a client id.
export const resendGuardianEmail = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    ok: boolean;
    error?: "not_eligible" | "rate_limited" | "send_failed";
  }> => {
    const outcome = await performGuardianSend(ctx, undefined, true);
    return outcome === "sent" ? { ok: true } : { ok: false, error: outcome };
  },
});

// The waiting panel's truth source: has a guardian email actually gone out?
export const myGuardianEmailStatus = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<null | { sent: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (member === null || member.lifecycle_state !== "pending_guardian") {
      return null;
    }
    const consent = await ctx.db
      .query("guardianConsents")
      .withIndex("by_member", (q) => q.eq("member_id", member._id))
      .order("desc")
      .first();
    return { sent: consent?.token_sent_at !== undefined };
  },
});

// The confirm page's first step: what does this token point at? NEVER
// confirms anything, and stays NEUTRAL: unknown, expired, and already-used
// tokens are all just "invalid" (spec criterion 2, no enumeration). The
// friendly already-done reply exists only on the explicit confirm mutation.
export const lookupGuardianToken = query({
  args: { token: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    state: "confirmable" | "invalid";
    applicantFirstName?: string;
  }> => {
    if (args.token.length < 16 || args.token.length > 128) {
      return { state: "invalid" };
    }
    const hash = await hashGuardianToken(args.token);
    const consent = await ctx.db
      .query("guardianConsents")
      .withIndex("by_token_hash", (q) => q.eq("confirmation_token_hash", hash))
      .unique();
    if (
      consent === null ||
      consent.confirmation_state !== "pending" ||
      consent.token_sent_at === undefined ||
      isGuardianTokenExpired(consent.token_sent_at, Date.now())
    ) {
      return { state: "invalid" };
    }
    const member = await ctx.db.get(consent.member_id);
    if (member === null || member.lifecycle_state !== "pending_guardian") {
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
// confirmed WITH the proof the vault requires (confirmed_at + the policy
// version agreed to), the member's age block upgraded to guardian_confirmed,
// lifecycle pending_guardian -> active (legal §6 transition), her certificate
// issued, everything audited. Idempotent: a repeat press of an
// already-confirmed token gets the friendly already-done reply.
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

    // The proof the vault requires: the action, when, and which policy.
    await ctx.db.patch(consent._id, {
      confirmation_state: "confirmed",
      confirmed_at: now,
      policy_version: POLICY_VERSION,
    });
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
      after_summary: `guardian confirmed by token; policy_version=${POLICY_VERSION}`,
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
