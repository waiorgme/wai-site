import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";

// Spec D11: the member-only directory, with the PRD §7.7 CANONICAL rule
// enforced server-side at query time (Stage 0 §5: "No UI may be the only
// thing enforcing a restriction"). A member is LISTED only when ALL hold:
// directory toggle ON + standing Active Member or above + lane standard/ally
// + lifecycle active. Minors and restricted_unknown never appear regardless
// of their settings, and as VIEWERS they are locked out entirely (the
// Under-18 block list includes the directory; the UI explains it opens at
// 18 / once age is confirmed).

// Same auth resolution as members.ts (getAuthUserId then the by_userId member
// lookup). Local copy: members.ts keeps its helper module-private.
const memberForAuthedUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return ctx.db
    .query("members")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
};

// Directory-tier fields ONLY (Member Profile Field Spec). Gender, date of
// birth, email and mobile are Private tier and never leave the server here.
export type DirectoryRow = {
  name: string;
  photo_url: string | null;
  headline: string | null;
  bio: string | null;
  country_of_residence: string | null;
  career_stage_answer: string | null;
  function_area: string | null;
  role: string | null;
  sectors: string[];
  looking_for: string[];
};

const LISTED_STANDINGS: ReadonlyArray<string> = [
  "active_member",
  "ambassador",
  "leadership_circle",
];
const LISTED_LANES: ReadonlyArray<string> = ["standard", "ally"];

// The one canonical predicate. Every condition lives here so no caller can
// ship a partial version of the rule.
const isListed = (m: Doc<"members">): boolean =>
  m.directory_visible === true &&
  LISTED_STANDINGS.includes(m.standing ?? "member") &&
  LISTED_LANES.includes(m.member_lane) &&
  m.lifecycle_state === "active";

export const listDirectory = query({
  args: {
    search: v.optional(v.string()),
    country: v.optional(v.string()),
    careerStage: v.optional(v.string()),
    sector: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<null | { rows: DirectoryRow[]; locked: boolean }> => {
    const viewer = await memberForAuthedUser(ctx);
    if (viewer === null) {
      // Signed out or no linked member row: the directory is member-only.
      return null;
    }
    // Under-18 / unknown-age viewers are blocked from the directory entirely
    // (switched off, not supervised). locked:true lets the UI explain it
    // opens at 18 (or once her age is confirmed).
    if (
      viewer.member_lane === "minor" ||
      viewer.member_lane === "restricted_unknown"
    ) {
      return { rows: [], locked: true };
    }
    // The viewer must herself be an active member; a dormant or suspended
    // account sees nothing (not the under-18 lock, just no rows).
    if (viewer.lifecycle_state !== "active") {
      return { rows: [], locked: false };
    }

    // Candidates come off the lifecycle index; the remaining canonical
    // conditions are checked in code (member counts are small at our scale,
    // and there is deliberately no partial index that could drift from the
    // one predicate above).
    const candidates = await ctx.db
      .query("members")
      .withIndex("by_lifecycle_state", (q) => q.eq("lifecycle_state", "active"))
      .collect();

    const search = (args.search ?? "").trim().toLowerCase();
    const rows: DirectoryRow[] = [];
    for (const m of candidates) {
      if (!isListed(m)) {
        continue;
      }
      // Search: name or headline substring, case-insensitive.
      if (search !== "") {
        const inName = m.name.toLowerCase().includes(search);
        const inHeadline = (m.headline ?? "").toLowerCase().includes(search);
        if (!inName && !inHeadline) {
          continue;
        }
      }
      // Filters: exact matches.
      if (
        args.country !== undefined &&
        args.country !== "" &&
        m.country_of_residence !== args.country
      ) {
        continue;
      }
      if (
        args.careerStage !== undefined &&
        args.careerStage !== "" &&
        m.career_stage_answer !== args.careerStage
      ) {
        continue;
      }
      if (
        args.sector !== undefined &&
        args.sector !== "" &&
        !(m.sectors ?? []).includes(args.sector)
      ) {
        continue;
      }
      rows.push({
        name: m.name,
        photo_url: m.photo_storage_id
          ? await ctx.storage.getUrl(m.photo_storage_id)
          : null,
        headline: m.headline ?? null,
        bio: m.bio ?? null,
        country_of_residence: m.country_of_residence ?? null,
        career_stage_answer: m.career_stage_answer ?? null,
        function_area: m.function_area ?? null,
        role: m.role ?? null,
        sectors: m.sectors ?? [],
        looking_for: m.looking_for ?? [],
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { rows, locked: false };
  },
});
