import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { decideWindow, type RateLimitRule } from "./lib/rateLimit";

// Consume one event against a fixed-window bucket, inside the CALLER's
// transaction. Convex serialises writes per document, so the read-modify-write
// is race-safe per key. Called directly from the auth callback (SEC-2: the
// check must share the transaction that replaces the verification code, so an
// over-limit throw rolls the replacement back) and wrapped as an
// internalMutation below for action callers.
export const consumeKey = async (
  ctx: MutationCtx,
  key: string,
  rule: RateLimitRule,
): Promise<{ ok: boolean; retryAfterMs: number }> => {
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
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
      key,
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
};

// Action-callable wrapper. Returns { ok } or { ok: false, retryAfterMs }.
export const consume = internalMutation({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; retryAfterMs: number }> =>
    consumeKey(ctx, args.key, { limit: args.limit, windowMs: args.windowMs }),
});
