import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

// Spec E12 (Stage 0 §4.6): the member's own notification center. Own rows
// ONLY, deny-by-default: every function resolves the member from the auth
// session (never a client-supplied member id), so a caller can never read or
// mark another member's rows, whatever the UI does. In-app channel only this
// slice; email is a recorded deferral until Resend Pro.

const PAGE_SIZE = 25;

// Same auth resolution as members.ts (getAuthUserId then the by_userId member
// lookup). Local copy: members.ts keeps its helper module-private.
const memberForAuthedUser = async (ctx: QueryCtx | MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return ctx.db
    .query("members")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
};

export type NotificationRow = {
  id: Doc<"notifications">["_id"];
  type: Doc<"notifications">["type"];
  title: string;
  body: string;
  href: string | null;
  read_at: number | null;
  created_at: number;
};

// The member's notification list, newest first, 25 per page (page is
// 0-based). Returns null when signed out or not linked to a member.
export const myNotifications = query({
  args: { page: v.optional(v.number()) },
  handler: async (ctx, args): Promise<NotificationRow[] | null> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return null;
    }
    const page = Math.max(0, Math.floor(args.page ?? 0));
    // take() up to the end of the requested page, then slice off the earlier
    // pages: fine at our scale (one member's notifications stay small).
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .order("desc")
      .take((page + 1) * PAGE_SIZE);
    return rows.slice(page * PAGE_SIZE).map((row) => ({
      id: row._id,
      type: row.type,
      title: row.title,
      body: row.body,
      href: row.href ?? null,
      read_at: row.read_at ?? null,
      created_at: row.created_at,
    }));
  },
});

// Unread badge count for the portal bell. 0 when signed out (nothing to show,
// nothing leaked).
export const unreadCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return 0;
    }
    // collect + filter is fine at our scale (a member accumulates at most a
    // few hundred rows); revisit with a read-state index only if that changes.
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .collect();
    return rows.filter((row) => row.read_at === undefined).length;
  },
});

// Read receipts are presentation state on the member's OWN rows, not a
// member-affecting change, so no §8 audit row is written here; the audited
// moments are the writes that INSERT notifications (RSVP, promotion, results,
// standing changes), which their own mutations audit.
export const markAllRead = mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: true } | { ok: false; error: "not_signed_in" }> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return { ok: false, error: "not_signed_in" };
    }
    const now = Date.now();
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .collect();
    for (const row of rows) {
      if (row.read_at === undefined) {
        await ctx.db.patch(row._id, { read_at: now });
      }
    }
    return { ok: true };
  },
});

// Mark one notification read. Own-row-only: a row that does not exist and a
// row belonging to another member return the SAME "not_found", so nothing
// about other members' rows can be probed.
export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: true } | { ok: false; error: "not_signed_in" | "not_found" }
  > => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return { ok: false, error: "not_signed_in" };
    }
    const row = await ctx.db.get(args.notificationId);
    if (row === null || row.member_id !== member._id) {
      return { ok: false, error: "not_found" };
    }
    if (row.read_at === undefined) {
      await ctx.db.patch(row._id, { read_at: Date.now() });
    }
    return { ok: true };
  },
});
