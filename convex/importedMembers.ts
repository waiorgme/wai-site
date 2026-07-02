import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { counterFloor } from "./lib/claim";
import { writeAudit } from "./lib/audit";

// Claim-wave import (Stage 0 §4.2). The 1,309 legacy rows land HERE, never
// directly in members, so claiming stays safe. Rows are pushed by
// scripts/import-members.py via `npx convex run` (Issam runs it; the member
// list itself never enters the repo). Idempotent on legacy_row_id: re-running
// the import never duplicates; a changed row (new hash) is updated in place
// unless it is already claimed, which is left alone and reported.

const importedRow = v.object({
  legacy_row_id: v.string(),
  legacy_row_hash: v.string(),
  normalized_email: v.string(),
  name: v.string(),
  mobile: v.optional(v.string()),
  dob_if_known: v.optional(v.string()),
  legacy_position: v.optional(v.string()),
  legacy_company: v.optional(v.string()),
  legacy_bio: v.optional(v.string()),
  gender: v.optional(v.union(v.literal("female"), v.literal("male"))),
  nationality: v.optional(v.string()),
  country_of_residence: v.optional(v.string()),
  legacy_membership_number: v.optional(v.number()),
  legacy_created_at: v.optional(v.string()),
  suppressed_minor: v.boolean(),
});

export const importBatch = internalMutation({
  args: { rows: v.array(importedRow) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    inserted: number;
    updated: number;
    unchanged: number;
    skipped_claimed: number;
  }> => {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped_claimed = 0;

    for (const row of args.rows) {
      const { suppressed_minor, ...fields } = row;
      const existing = await ctx.db
        .query("importedMembers")
        .withIndex("by_normalized_email", (q) =>
          q.eq("normalized_email", row.normalized_email),
        )
        .collect();
      const match = existing.find((r) => r.legacy_row_id === row.legacy_row_id);

      if (match === undefined) {
        await ctx.db.insert("importedMembers", {
          ...fields,
          claim_state: suppressed_minor ? "suppressed_minor" : "unclaimed",
          match_signals: { email: false, name: false, mobile: false, dob: false },
        });
        inserted += 1;
      } else if (match.claim_state === "claimed" || match.claim_state === "claim_in_progress") {
        // Never rewrite a row a member has already acted on.
        skipped_claimed += 1;
      } else if (match.legacy_row_hash !== row.legacy_row_hash) {
        await ctx.db.patch(match._id, {
          ...fields,
          claim_state: suppressed_minor ? "suppressed_minor" : match.claim_state,
        });
        updated += 1;
      } else {
        unchanged += 1;
      }
    }

    await writeAudit(ctx, {
      actor: "import-script",
      role: "admin_fallback",
      action: "importBatch",
      target_id: "importedMembers",
      after_summary: `inserted=${inserted} updated=${updated} unchanged=${unchanged} skipped_claimed=${skipped_claimed}`,
      source: "agent",
    });

    return { inserted, updated, unchanged, skipped_claimed };
  },
});

// DATA-1: after importing, raise the membership counter so new signups can
// never collide with legacy WAIME-### numbers. Never lowers the counter.
export const raiseCounterFloor = internalMutation({
  args: { maxLegacyNumber: v.number() },
  handler: async (ctx, args): Promise<{ counter: number }> => {
    const floor = counterFloor(args.maxLegacyNumber);
    const row = await ctx.db
      .query("counters")
      .withIndex("by_name", (q) => q.eq("name", "membership_number"))
      .unique();
    let value: number;
    if (row === null) {
      value = floor;
      await ctx.db.insert("counters", { name: "membership_number", value });
    } else {
      value = Math.max(row.value, floor);
      await ctx.db.patch(row._id, { value });
    }
    await writeAudit(ctx, {
      actor: "import-script",
      role: "admin_fallback",
      action: "raiseCounterFloor",
      target_id: "counters:membership_number",
      after_summary: `maxLegacy=${args.maxLegacyNumber} counter=${value}`,
      source: "agent",
    });
    return { counter: value };
  },
});
