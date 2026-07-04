import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireSuperAdmin } from "../lib/adminAuth";

// Audit visibility, read-only (spec criterion 8): a paginated view of recent
// auditLog rows filtered to source = "admin_fallback", so a super admin can see
// what the panel itself has done. This is the audit-log promise from
// 02 Admin Approach - Agent-Operated made visible, not a new logging mechanism.
// Summaries are already PII-free (§8), so nothing extra is masked here.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export type AdminAuditRow = {
  id: string;
  actor: string;
  action: string;
  target_id: string;
  after_summary: string | null;
  timestamp: number;
};

export const listAdminAuditLog = query({
  args: { limit: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ rows: AdminAuditRow[]; nextCursor: string | null }> => {
    await requireSuperAdmin(ctx);
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    // Paginate source=admin_fallback DIRECTLY via the by_source_time index, so a
    // page is always admin rows (never a page of member/system rows that hides
    // older admin actions, then falsely reads as "nothing recorded"). Newest
    // first.
    const page = await ctx.db
      .query("auditLog")
      .withIndex("by_source_time", (q) => q.eq("source", "admin_fallback"))
      .order("desc")
      .paginate({
        numItems: limit,
        cursor: args.cursor ?? null,
      });
    const rows: AdminAuditRow[] = page.page.map((row) => ({
      id: row._id,
      actor: row.actor,
      action: row.action,
      target_id: row.target_id,
      after_summary: row.after_summary ?? null,
      timestamp: row.timestamp,
    }));
    return {
      rows,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
