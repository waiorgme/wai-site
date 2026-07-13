// The AGENT ACCESS surface: the curated set of admin capabilities a
// super-admin's OWN AI agent (Codex or any MCP client) may call, gated by a
// per-admin bearer key (agentKeys table) instead of a browser session. Design
// rules, in order of importance:
//
// 1. DENY BY DEFAULT. Every function validates the key server-side against
//    the stored hash AND re-checks that the key's owner is still on
//    SUPER_ADMIN_EMAILS. A revoked key, an unknown key, or a demoted owner
//    all fail with the same neutral NOT_AUTHORIZED.
// 2. CURATED, NOT GENERAL. Only the tools listed here exist. There is
//    deliberately NO agent path to: reveal member contact details (panel-only,
//    audited), confirm a guardian consent (guardian's own click only), issue
//    or revoke certificates, change member status, or touch config. The admin
//    panel remains the full-capability manual fallback.
// 3. SAME LOGIC, NEVER FORKED. Writes reuse the exact shared implementations
//    the panel uses (applyPipelineDecision, performGuardianSend), so throttles
//    and invariants cannot be sidestepped by coming in through the agent door.
// 4. EVERYTHING ATTRIBUTED. Every write audits with source "agent" and the
//    OWNER's email as actor, so the log always reads "Mervat, via her agent".
// 5. PII-MINIMAL READS. List surfaces return the same masked shapes the panel
//    lists use; raw emails, DOBs and guardian details never leave the server.
//
// Key lifecycle (internal = deployment-CLI only, i.e. Issam):
//   npx convex run agent:issueAgentKey '{"email":"mervat@waiorg.me"}'
//   npx convex run agent:revokeAgentKeys '{"email":"mervat@waiorg.me"}'

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  generateGuardianToken,
  hashGuardianToken,
} from "./lib/guardianToken";
import { isAllowedAdminEmail, NOT_AUTHORIZED } from "./lib/adminAuth";
import { maskName } from "./lib/adminMask";
import { latestPipelineConsent } from "./lib/pipeline";
import {
  applyPipelineDecision,
  type PipelineDecideResult,
} from "./lib/pipelineDecide";
import { writeAudit } from "./lib/audit";
import { isSafeHttpsUrl } from "./lib/url";
import { performGuardianSend } from "./guardians";

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 25;
const NOTE_MAX = 2000;

// Resolve a presented key to its owning super-admin, or throw neutrally.
const requireAgentAdmin = async (
  ctx: QueryCtx | MutationCtx,
  agentKey: string,
): Promise<{ email: string; keyId: Id<"agentKeys"> }> => {
  const hash = await hashGuardianToken(agentKey);
  const key = await ctx.db
    .query("agentKeys")
    .withIndex("by_hash", (q) => q.eq("key_hash", hash))
    .unique();
  if (key === null || key.revoked_at !== undefined) {
    throw new Error(NOT_AUTHORIZED);
  }
  if (!isAllowedAdminEmail(process.env.SUPER_ADMIN_EMAILS, key.admin_email)) {
    throw new Error(NOT_AUTHORIZED);
  }
  return { email: key.admin_email, keyId: key._id };
};

// ---------------------------------------------------------------- key admin

export const issueAgentKey = internalMutation({
  args: { email: v.string(), label: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ key: string; admin_email: string }> => {
    const email = args.email.trim().toLowerCase();
    // Keys exist only for CURRENT super-admins; this cannot mint access for
    // anyone the allowlist does not already trust.
    if (!isAllowedAdminEmail(process.env.SUPER_ADMIN_EMAILS, email)) {
      throw new Error(NOT_AUTHORIZED);
    }
    // 256-bit random, prefixed so a leaked string is recognisable in scans.
    const key = `wai_agent_${generateGuardianToken()}${generateGuardianToken()}`;
    await ctx.db.insert("agentKeys", {
      admin_email: email,
      key_hash: await hashGuardianToken(key),
      label: args.label ?? "codex",
      created_at: Date.now(),
    });
    await writeAudit(ctx, {
      actor: email,
      role: "agent",
      action: "issueAgentKey",
      target_id: email,
      after_summary: `agent access key issued (label=${args.label ?? "codex"})`,
      source: "system",
    });
    return { key, admin_email: email };
  },
});

export const revokeAgentKeys = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args): Promise<{ revoked: number }> => {
    const email = args.email.trim().toLowerCase();
    const keys = await ctx.db.query("agentKeys").collect();
    let revoked = 0;
    for (const key of keys) {
      if (key.admin_email === email && key.revoked_at === undefined) {
        await ctx.db.patch(key._id, { revoked_at: Date.now() });
        revoked += 1;
      }
    }
    if (revoked > 0) {
      await writeAudit(ctx, {
        actor: email,
        role: "agent",
        action: "revokeAgentKeys",
        target_id: email,
        after_summary: `agent access keys revoked (count=${revoked})`,
        source: "system",
      });
    }
    return { revoked };
  },
});

// -------------------------------------------------------------------- reads

export const whoami = query({
  args: { agentKey: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ admin_email: string; surface: string[] }> => {
    const { email } = await requireAgentAdmin(ctx, args.agentKey);
    return {
      admin_email: email,
      surface: [
        "overview",
        "listPendingGuardians",
        "listPendingPipelineReviews",
        "searchMembers",
        "listEvents",
        "getEventDetail",
        "updateEventDetails",
        "recentAudit",
        "resendGuardianEmail",
        "decidePipelineReview",
        "addMemberNote",
      ],
    };
  },
});

export const overview = query({
  args: { agentKey: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    members_by_lifecycle: Record<string, number>;
    pending_guardian_consents: number;
    pending_pipeline_reviews: number;
    upcoming_events: number;
  }> => {
    await requireAgentAdmin(ctx, args.agentKey);
    const members = await ctx.db.query("members").collect();
    const members_by_lifecycle: Record<string, number> = {};
    for (const m of members) {
      members_by_lifecycle[m.lifecycle_state] =
        (members_by_lifecycle[m.lifecycle_state] ?? 0) + 1;
    }
    const consents = await ctx.db.query("guardianConsents").collect();
    const pending_guardian_consents = consents.filter(
      (c) =>
        c.confirmation_state === "pending" ||
        c.confirmation_state === "expired",
    ).length;
    const reviews = await ctx.db
      .query("pipelineEligibilityReviews")
      .withIndex("by_state", (q) => q.eq("state", "pending"))
      .collect();
    const now = Date.now();
    const events = await ctx.db.query("events").collect();
    return {
      members_by_lifecycle,
      pending_guardian_consents,
      pending_pipeline_reviews: reviews.length,
      upcoming_events: events.filter((e) => e.starts_at > now).length,
    };
  },
});

// Mirrors convex/admin/guardians.ts listPendingGuardians field-for-field (the
// masked, PII-minimal queue shape). Kept in lockstep by the shared row type.
export const listPendingGuardians = query({
  args: { agentKey: v.string() },
  handler: async (ctx, args) => {
    await requireAgentAdmin(ctx, args.agentKey);
    const now = Date.now();
    const consents = await ctx.db.query("guardianConsents").collect();
    const rows = [];
    for (const consent of consents) {
      if (
        consent.confirmation_state !== "pending" &&
        consent.confirmation_state !== "expired"
      ) {
        continue;
      }
      const member = await ctx.db.get(consent.member_id);
      if (member === null) {
        continue;
      }
      rows.push({
        consentId: consent._id,
        memberId: member._id,
        member_first_name: member.name.split(" ")[0] ?? "(unnamed)",
        member_lane: member.member_lane,
        masked_guardian_name: maskName(consent.guardian_name),
        confirmation_state: consent.confirmation_state,
        token_sent_at: consent.token_sent_at ?? null,
        days_waiting: Math.floor((now - consent._creationTime) / DAY_MS),
      });
    }
    return rows;
  },
});

// Mirrors convex/admin/pipelineReviews.ts listPendingReviews (masked).
export const listPendingPipelineReviews = query({
  args: { agentKey: v.string() },
  handler: async (ctx, args) => {
    await requireAgentAdmin(ctx, args.agentKey);
    const now = Date.now();
    const reviews = await ctx.db
      .query("pipelineEligibilityReviews")
      .withIndex("by_state", (q) => q.eq("state", "pending"))
      .collect();
    const rows = [];
    for (const review of reviews) {
      const member = await ctx.db.get(review.member_id);
      if (member === null) {
        continue;
      }
      const consent = await latestPipelineConsent(ctx, member._id);
      rows.push({
        reviewId: review._id,
        masked_name: maskName(member.name),
        lane: member.member_lane,
        days_open: Math.floor((now - review._creationTime) / DAY_MS),
        consent_on_file: consent !== null,
        consent_date: consent?.timestamp ?? null,
        consent_source: consent?.source ?? null,
      });
    }
    return rows;
  },
});

// PII-minimal member search: same no-email rule as the panel list (the query
// matches on email server-side, but the row never carries it out).
export const searchMembers = query({
  args: {
    agentKey: v.string(),
    search: v.optional(v.string()),
    lifecycle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAgentAdmin(ctx, args.agentKey);
    const all = await ctx.db.query("members").collect();
    const needle = (args.search ?? "").trim().toLowerCase();
    const filtered = all.filter((m: Doc<"members">) => {
      if (
        args.lifecycle !== undefined &&
        m.lifecycle_state !== args.lifecycle
      ) {
        return false;
      }
      if (needle === "") {
        return true;
      }
      return (
        m.name.toLowerCase().includes(needle) ||
        m.email.toLowerCase().includes(needle)
      );
    });
    filtered.sort((a, b) => b.created_at - a.created_at);
    return {
      total: filtered.length,
      shown: Math.min(filtered.length, LIST_LIMIT),
      rows: filtered.slice(0, LIST_LIMIT).map((m) => ({
        memberId: m._id,
        name: m.name,
        lane: m.member_lane,
        lifecycle_state: m.lifecycle_state,
        joined: new Date(m.created_at).toISOString().slice(0, 10),
      })),
    };
  },
});

export const listEvents = query({
  args: { agentKey: v.string() },
  handler: async (ctx, args) => {
    await requireAgentAdmin(ctx, args.agentKey);
    const events = await ctx.db.query("events").collect();
    events.sort((a, b) => b.starts_at - a.starts_at);
    return events.slice(0, LIST_LIMIT).map((e) => ({
      eventId: e._id,
      title: e.title,
      category: e.category,
      state: e.state,
      starts_at: new Date(e.starts_at).toISOString(),
      format: e.format,
      city: e.city ?? null,
    }));
  },
});

export const getEventDetail = query({
  args: { agentKey: v.string(), eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireAgentAdmin(ctx, args.agentKey);
    const e = await ctx.db.get(args.eventId);
    if (e === null) {
      return null;
    }
    return {
      eventId: e._id,
      title: e.title,
      category: e.category,
      state: e.state,
      short_description: e.short_description,
      starts_at: new Date(e.starts_at).toISOString(),
      ends_at: new Date(e.ends_at).toISOString(),
      timezone: e.timezone,
      format: e.format,
      venue: e.venue ?? null,
      city: e.city ?? null,
      meeting_link: e.meeting_link ?? null,
      audience_lane: e.audience_lane,
      capacity: e.capacity ?? null,
    };
  },
});

export const recentAudit = query({
  args: { agentKey: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAgentAdmin(ctx, args.agentKey);
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 20)), 50);
    const rows = await ctx.db.query("auditLog").order("desc").take(limit);
    return rows.map((r) => ({
      timestamp: new Date(r.timestamp).toISOString(),
      actor: r.actor,
      role: r.role,
      action: r.action,
      target_id: r.target_id,
      after_summary: r.after_summary ?? null,
      source: r.source,
    }));
  },
});

// ------------------------------------------------------------------- writes

// Shared decision logic (lib/pipelineDecide.ts): the SAME invariant path the
// panel and the break-glass CLI use; the agent cannot approve what they can't.
export const decidePipelineReview = mutation({
  args: {
    agentKey: v.string(),
    reviewId: v.id("pipelineEligibilityReviews"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PipelineDecideResult> => {
    let email: string;
    let keyId: Id<"agentKeys">;
    try {
      ({ email, keyId } = await requireAgentAdmin(ctx, args.agentKey));
    } catch {
      return { ok: false, error: NOT_AUTHORIZED };
    }
    await ctx.db.patch(keyId, { last_used_at: Date.now() });
    return applyPipelineDecision(ctx, {
      reviewId: args.reviewId,
      decision: args.decision,
      reviewer: email,
      reason: args.reason,
      source: "agent",
    });
  },
});

// Narrow event-details editor: the fields Mervat actually maintains between
// events (title, when, where, registration/meeting link, blurb). Deliberately
// NOT create/publish/cancel - those carry lifecycle invariants (audience/time
// freeze once live, meeting-link rules at publish) that stay panel-only. Link
// validation is the SAME isSafeHttpsUrl every stored member-facing link uses.
export const updateEventDetails = mutation({
  args: {
    agentKey: v.string(),
    eventId: v.id("events"),
    title: v.optional(v.string()),
    short_description: v.optional(v.string()),
    starts_at: v.optional(v.string()), // ISO datetime
    ends_at: v.optional(v.string()),
    timezone: v.optional(v.string()),
    venue: v.optional(v.string()),
    city: v.optional(v.string()),
    meeting_link: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; updated: string[] }
    | { ok: false; error: "not_authorized" | "not_found" | "validation"; detail?: string }
  > => {
    let email: string;
    let keyId: Id<"agentKeys">;
    try {
      ({ email, keyId } = await requireAgentAdmin(ctx, args.agentKey));
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const event = await ctx.db.get(args.eventId);
    if (event === null) {
      return { ok: false, error: "not_found" };
    }
    const patch: Record<string, string | number> = {};
    const updated: string[] = [];
    const fail = (detail: string) =>
      ({ ok: false, error: "validation", detail }) as const;

    if (args.title !== undefined) {
      const title = args.title.trim();
      if (title.length === 0 || title.length > 200) {
        return fail("title must be 1-200 characters");
      }
      patch.title = title;
      updated.push("title");
    }
    if (args.short_description !== undefined) {
      const blurb = args.short_description.trim();
      if (blurb.length === 0 || blurb.length > 500) {
        return fail("short_description must be 1-500 characters");
      }
      patch.short_description = blurb;
      updated.push("short_description");
    }
    let starts = event.starts_at;
    let ends = event.ends_at;
    if (args.starts_at !== undefined) {
      const t = Date.parse(args.starts_at);
      if (Number.isNaN(t)) {
        return fail("starts_at is not a valid ISO datetime");
      }
      starts = t;
      patch.starts_at = t;
      updated.push("starts_at");
    }
    if (args.ends_at !== undefined) {
      const t = Date.parse(args.ends_at);
      if (Number.isNaN(t)) {
        return fail("ends_at is not a valid ISO datetime");
      }
      ends = t;
      patch.ends_at = t;
      updated.push("ends_at");
    }
    if (ends <= starts) {
      return fail("ends_at must be after starts_at");
    }
    if (args.timezone !== undefined) {
      const tz = args.timezone.trim();
      if (tz.length === 0 || tz.length > 40) {
        return fail("timezone must be 1-40 characters");
      }
      patch.timezone = tz;
      updated.push("timezone");
    }
    if (args.venue !== undefined) {
      const venue = args.venue.trim();
      if (venue.length > 200) {
        return fail("venue must be at most 200 characters");
      }
      patch.venue = venue;
      updated.push("venue");
    }
    if (args.city !== undefined) {
      const city = args.city.trim();
      if (city.length > 100) {
        return fail("city must be at most 100 characters");
      }
      patch.city = city;
      updated.push("city");
    }
    if (args.meeting_link !== undefined) {
      const link = args.meeting_link.trim();
      if (link !== "" && !isSafeHttpsUrl(link)) {
        return fail("meeting_link must be a plain https URL");
      }
      patch.meeting_link = link;
      updated.push("meeting_link");
    }
    if (updated.length === 0) {
      return fail("no fields to update");
    }
    await ctx.db.patch(keyId, { last_used_at: Date.now() });
    await ctx.db.patch(event._id, patch);
    await writeAudit(ctx, {
      actor: email,
      role: "agent",
      action: "updateEventDetails",
      target_id: event._id,
      before_summary: `event "${event.title}" (${event.state})`,
      after_summary: `updated via agent: ${updated.join(", ")}`,
      source: "agent",
    });
    return { ok: true, updated };
  },
});

// Mirrors admin/members.ts addMemberNote; author is the KEY OWNER, audit
// source is "agent" so the trail always distinguishes agent from in-person.
export const addMemberNote = mutation({
  args: {
    agentKey: v.string(),
    memberId: v.id("members"),
    text: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; noteId: Id<"adminNotes"> }
    | { ok: false; error: "not_authorized" | "not_found" | "validation" }
  > => {
    let email: string;
    let keyId: Id<"agentKeys">;
    try {
      ({ email, keyId } = await requireAgentAdmin(ctx, args.agentKey));
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const text = args.text.trim();
    if (text.length === 0 || text.length > NOTE_MAX) {
      return { ok: false, error: "validation" };
    }
    const member = await ctx.db.get(args.memberId);
    if (member === null) {
      return { ok: false, error: "not_found" };
    }
    await ctx.db.patch(keyId, { last_used_at: Date.now() });
    const noteId = await ctx.db.insert("adminNotes", {
      member_id: member._id,
      author: email,
      text,
      created_at: Date.now(),
    });
    await writeAudit(ctx, {
      actor: email,
      role: "agent",
      action: "addMemberNote",
      target_id: member._id,
      after_summary: `note added via agent (length=${text.length})`,
      source: "agent",
    });
    return { ok: true, noteId };
  },
});

// Action-side key check: actions have no ctx.db, so validation runs in this
// internal query (same code path as everywhere else).
export const resolveAgentAdmin = internalQuery({
  args: { agentKey: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ email: string; keyId: Id<"agentKeys"> }> =>
    requireAgentAdmin(ctx, args.agentKey),
});

export const stampAgentUse = internalMutation({
  args: { keyId: v.id("agentKeys") },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.keyId, { last_used_at: Date.now() });
  },
});

export const writeAgentAudit = internalMutation({
  args: {
    actor: v.string(),
    action: v.string(),
    targetId: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await writeAudit(ctx, {
      actor: args.actor,
      role: "agent",
      action: args.action,
      target_id: args.targetId,
      after_summary: args.summary,
      source: "agent",
    });
  },
});

// Reuses the ONE guardian send path (rotation, per-target throttle, global
// cap, rollback on provider failure) under the admin_resend rules. Read-and-
// nudge only: no agent path can ever set confirmation_state = confirmed.
export const resendGuardianEmail = action({
  args: { agentKey: v.string(), memberId: v.id("members") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    error?: "not_authorized" | "not_eligible" | "rate_limited" | "send_failed";
  }> => {
    let admin: { email: string; keyId: Id<"agentKeys"> };
    try {
      admin = await ctx.runQuery(internal.agent.resolveAgentAdmin, {
        agentKey: args.agentKey,
      });
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    await ctx.runMutation(internal.agent.stampAgentUse, { keyId: admin.keyId });
    const outcome = await performGuardianSend(
      ctx,
      args.memberId,
      "admin_resend",
    );
    await ctx.runMutation(internal.agent.writeAgentAudit, {
      actor: admin.email,
      action: "resendGuardianEmail",
      targetId: args.memberId,
      summary: `guardian resend via agent outcome=${outcome}`,
    });
    if (outcome === "sent") {
      return { ok: true };
    }
    return {
      ok: false,
      error: outcome === "not_eligible" || outcome === "rate_limited" || outcome === "send_failed"
        ? outcome
        : "not_eligible",
    };
  },
});
