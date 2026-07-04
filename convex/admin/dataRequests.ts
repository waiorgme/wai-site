import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireSuperAdmin } from "../lib/adminAuth";
import { verifyTurnstile } from "../lib/turnstile";
import { writeAudit } from "../lib/audit";
import { maskName } from "../lib/adminMask";
import { consumeKey } from "../rateLimit";
import { normalizeEmail, isValidJoinEmail } from "../lib/joinValidation";

// DataRequest route (spec criteria 5 + 6): the deferred PRD §6.5 feature. A
// subject asks to see or erase her data; the row is a RECORD ONLY, never a side
// effect on any member row (Stage 0 §8's negative test: submitting is not
// approving; a visitor cannot trigger deletion of anyone else's data). state:
// submitted -> identity_pending -> approved -> fulfilled|rejected.
//
// BUILT here: the schema, submitDataRequest (creation-only), the signed-in
// member's own submission, the admin listDataRequests queue, and
// approveDataRequest's state transition + audit. NOT BUILT (Open Question 2,
// halted): fulfilExport's field list and executeErasure's scrub logic. Those
// named actions are intentionally absent until a dated decision exists.

// Per-email daily cap on submissions, so nobody can spam-submit someone else's
// address (criterion 5). Reuses the shared fixed-window limiter conventions.
const DATA_REQUEST_PER_EMAIL_DAY = { limit: 3, windowMs: 24 * 60 * 60 * 1000 };
const DATA_REQUEST_GLOBAL_DAY = { limit: 100, windowMs: 24 * 60 * 60 * 1000 };

const DAY_MS = 24 * 60 * 60 * 1000;

// The record write, shared by the visitor action and the signed-in member
// mutation. linked_member_id is resolved SERVER-SIDE (never client-supplied):
// if the subject email matches an existing member, we link it. No member-row
// mutation happens here (criterion 5): the submitted request is inert until an
// admin approves.
export const createDataRequestRecord = internalMutation({
  args: {
    subject_email: v.string(),
    kind: v.union(v.literal("export"), v.literal("erasure")),
    source: v.union(v.literal("member"), v.literal("system")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ requestId: Id<"dataRequests">; state: "submitted" }> => {
    const email = normalizeEmail(args.subject_email);
    const member = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    const requestId = await ctx.db.insert("dataRequests", {
      subject_email: email,
      linked_member_id: member?._id,
      kind: args.kind,
      state: "submitted",
      created_at: Date.now(),
    });
    // PII-free summary: request id + kind only (criterion 5). The subject email
    // is stored on the row, never restated in the audit text.
    await writeAudit(ctx, {
      actor: args.source === "member" ? email : "system",
      role: args.source === "member" ? "member" : "system",
      action: "submitDataRequest",
      target_id: requestId,
      after_summary: `dataRequest submitted kind=${args.kind}`,
      source: args.source,
    });
    return { requestId, state: "submitted" };
  },
});

// Visitor + not-signed-in submission (Stage 0 §7.1 shape { subject_email, kind }
// -> { requestId, state: 'submitted' }). An ACTION because it verifies Turnstile
// the same way submitJoin does (reusing the shared verifier). Rate-limited
// per-email + global. Creates only a record (criterion 5, §8 negative test).
export const submitDataRequest = action({
  args: {
    subject_email: v.string(),
    kind: v.union(v.literal("export"), v.literal("erasure")),
    turnstileToken: v.string(),
    // Honeypot, same convention as submitJoin.
    website: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; requestId: Id<"dataRequests">; state: "submitted" }
    | { ok: false; error: "validation" | "rate_limited" }
  > => {
    // Honeypot: silently drop, same shape as the happy path so a bot learns
    // nothing (no row written).
    if (args.website !== undefined && args.website !== "") {
      return { ok: false, error: "validation" };
    }
    if (!isValidJoinEmail(args.subject_email)) {
      return { ok: false, error: "validation" };
    }
    // Human check FIRST, before any stored state (same ordering as submitJoin,
    // so a failed token can never burn a victim's rate-limit budget).
    const human = await verifyTurnstile(args.turnstileToken);
    if (!human) {
      return { ok: false, error: "validation" };
    }
    const email = normalizeEmail(args.subject_email);
    for (const { key, rule } of [
      { key: `datareq24h:${email}`, rule: DATA_REQUEST_PER_EMAIL_DAY },
      { key: "datareq24h:global", rule: DATA_REQUEST_GLOBAL_DAY },
    ]) {
      const res = await ctx.runMutation(internal.rateLimit.consume, {
        key,
        limit: rule.limit,
        windowMs: rule.windowMs,
      });
      if (!res.ok) {
        return { ok: false, error: "rate_limited" };
      }
    }
    const created = await ctx.runMutation(
      internal.admin.dataRequests.createDataRequestRecord,
      { subject_email: email, kind: args.kind, source: "system" },
    );
    return { ok: true, requestId: created.requestId, state: created.state };
  },
});

// A signed-in member's own request (criterion 5: "as the member area grows"),
// surfaced in her settings "Your data" section. subject_email is taken from her
// session, never a free-text field: a member can only ask about HER OWN data
// this way. No Turnstile (she is already authenticated); rate-limited per email.
export const submitMyDataRequest = mutation({
  args: { kind: v.union(v.literal("export"), v.literal("erasure")) },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; requestId: Id<"dataRequests">; state: "submitted" }
    | { ok: false; error: "not_signed_in" | "rate_limited" }
  > => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { ok: false, error: "not_signed_in" };
    }
    const user = await ctx.db.get(userId);
    const rawEmail = (user as { email?: string } | null)?.email;
    if (typeof rawEmail !== "string") {
      return { ok: false, error: "not_signed_in" };
    }
    const email = normalizeEmail(rawEmail);
    // Per-email daily cap, in-transaction (same limiter the action uses).
    const limited = await consumeKey(ctx, `datareq24h:${email}`, DATA_REQUEST_PER_EMAIL_DAY);
    if (!limited.ok) {
      return { ok: false, error: "rate_limited" };
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    const requestId = await ctx.db.insert("dataRequests", {
      subject_email: email,
      linked_member_id: member?._id,
      kind: args.kind,
      state: "submitted",
      created_at: Date.now(),
    });
    await writeAudit(ctx, {
      actor: email,
      role: "member",
      action: "submitDataRequest",
      target_id: requestId,
      after_summary: `dataRequest submitted kind=${args.kind}`,
      source: "member",
    });
    return { ok: true, requestId, state: "submitted" };
  },
});

export type DataRequestRow = {
  requestId: string;
  subject_email: string;
  kind: "export" | "erasure";
  state: "submitted" | "identity_pending";
  linked_member_name: string | null;
  days_open: number;
};

// Admin queue (criterion 6): rows still in submitted / identity_pending. The
// subject email is shown (it is the request's own key, and an admin needs it to
// act on the request); a linked member is resolved to a masked name, never a
// full member record. No general member search (criterion 10).
export const listDataRequests = query({
  args: {},
  handler: async (ctx): Promise<DataRequestRow[]> => {
    await requireSuperAdmin(ctx);
    const now = Date.now();
    const submitted = await ctx.db
      .query("dataRequests")
      .withIndex("by_state", (q) => q.eq("state", "submitted"))
      .collect();
    const identityPending = await ctx.db
      .query("dataRequests")
      .withIndex("by_state", (q) => q.eq("state", "identity_pending"))
      .collect();
    const rows: DataRequestRow[] = [];
    for (const req of [...submitted, ...identityPending]) {
      let linkedName: string | null = null;
      if (req.linked_member_id !== undefined) {
        const member = await ctx.db.get(req.linked_member_id);
        linkedName = member === null ? null : maskName(member.name);
      }
      rows.push({
        requestId: req._id,
        subject_email: req.subject_email,
        kind: req.kind,
        state: req.state as "submitted" | "identity_pending",
        linked_member_name: linkedName,
        days_open: Math.floor((now - req.created_at) / DAY_MS),
      });
    }
    return rows;
  },
});

// approveDataRequest (criterion 6): the state transition + audit only. The
// admin confirms how identity was verified (verification_method, a required
// short operational note) and decides approved / rejected. This does NOT
// perform the export or the erasure: fulfilExport and executeErasure are
// separate, per-kind, post-approval actions that are HALTED at build time
// (Open Question 2). Approving here only moves the request to `approved` (or
// `rejected`) and records who did it.
export const approveDataRequest = mutation({
  args: {
    requestId: v.id("dataRequests"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    verification_method: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; state: "approved" | "rejected" }
    | { ok: false; error: "not_authorized" | "not_found" | "validation" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireSuperAdmin(ctx);
    } catch {
      // Neutral error (criterion 10): a non-admin caller cannot tell why.
      return { ok: false, error: "not_authorized" };
    }
    // verification_method is required for an approval (how identity was
    // confirmed); enforce non-empty. A rejection also records the note.
    const note = args.verification_method.trim();
    if (note.length === 0 || note.length > 300) {
      return { ok: false, error: "validation" };
    }
    const req = await ctx.db.get(args.requestId);
    if (
      req === null ||
      (req.state !== "submitted" && req.state !== "identity_pending")
    ) {
      // Same neutral shape whether the row is missing or in the wrong state.
      return { ok: false, error: "not_found" };
    }
    const now = Date.now();
    await ctx.db.patch(req._id, {
      state: args.decision,
      verification_method: note,
      approver: adminEmail,
      decided_at: now,
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "approveDataRequest",
      target_id: req._id,
      after_summary: `dataRequest ${args.decision} kind=${req.kind}`,
      source: "admin_fallback",
    });
    return { ok: true, state: args.decision };
  },
});
