import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { decideWindow, type RateLimitRule } from "./lib/rateLimit";

// Consume one event against a fixed-window bucket. Returns { ok } or
// { ok: false, retryAfterMs }. Convex serialises writes per document, so the
// read-modify-write here is race-safe per key.
export const consume = internalMutation({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; retryAfterMs: number }> => {
    const rule: RateLimitRule = { limit: args.limit, windowMs: args.windowMs };
    const now = Date.now();
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const decision = decideWindow(
      row === null ? null : { window_start: row.window_start, count: row.count },
      rule,
      now,
    );
    if (!decision.allowed) {
      return { ok: false, retryAfterMs: decision.retryAfterMs };
    }
    if (row === null) {
      await ctx.db.insert("rateLimits", {
        key: args.key,
        window_start: decision.next.window_start,
        count: decision.next.count,
      });
    } else {
      await ctx.db.patch(row._id, {
        window_start: decision.next.window_start,
        count: decision.next.count,
      });
    }
    return { ok: true, retryAfterMs: 0 };
  },
});
