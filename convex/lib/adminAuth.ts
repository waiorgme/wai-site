import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";

// Admin identity (spec criterion 1). A super admin is identified SERVER-SIDE by
// comparing the signed-in member's lower-cased email against a deployment env
// var (SUPER_ADMIN_EMAILS, comma-separated), set via `npx convex env set` on
// each deployment, never committed to the repo and never accepted as a
// client-supplied argument. This matches the TURNSTILE_SECRET_KEY / SITE_URL
// precedent. Deny-by-default (Stage 0 §3): an unset or empty allowlist means no
// one is admin, not "let anyone in."

// Pure allowlist logic, unit-tested: parse the comma-separated env value into a
// lower-cased, trimmed set and answer "is this email allowed". Case-insensitive
// on both sides; empty/unset denies; blank entries are ignored.
export const parseAllowlist = (raw: string | undefined): string[] => {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
};

export const isAllowedAdminEmail = (
  raw: string | undefined,
  email: string | null,
): boolean => {
  if (email === null || email === "") {
    return false;
  }
  const allow = parseAllowlist(raw);
  return allow.includes(email.trim().toLowerCase());
};

// The one neutral error every admin function returns/throws on failure, so a
// caller can never tell WHY it failed (wrong admin vs no such row vs wrong
// state), per criterion 10 and Stage 0 §7.1's named-error convention.
export const NOT_AUTHORIZED = "not_authorized" as const;

// Resolve the caller's member email from auth (never a client arg). The auth
// user row carries the email; we lower-case it, matching authedEmail in
// members.ts.
const callerEmail = async (
  ctx: QueryCtx | MutationCtx,
): Promise<string | null> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  const user = await ctx.db.get(userId);
  const email = (user as { email?: string } | null)?.email;
  return typeof email === "string" ? email.toLowerCase() : null;
};

// Called FIRST in every admin function this spec adds. Returns the admin's
// email (the audit actor) on success; throws NOT_AUTHORIZED on any failure
// without revealing which check failed. Queries and mutations both use this;
// throwing (rather than returning an envelope) keeps the query contract per
// Stage 0 §7.1.
export const requireSuperAdmin = async (
  ctx: QueryCtx | MutationCtx,
): Promise<string> => {
  const email = await callerEmail(ctx);
  if (!isAllowedAdminEmail(process.env.SUPER_ADMIN_EMAILS, email)) {
    throw new Error(NOT_AUTHORIZED);
  }
  // email is non-null here: isAllowedAdminEmail returned true.
  return email as string;
};

// Actions have no `ctx.db`, so they cannot run the check directly. This internal
// query does the same resolve-and-allowlist inside a query context; an action
// gate (requireSuperAdminInAction below) calls it. Throws NOT_AUTHORIZED on
// failure, returns the admin email on success.
export const resolveSuperAdmin = internalQuery({
  args: {},
  handler: async (ctx): Promise<string> => requireSuperAdmin(ctx),
});

// The action-side gate: same neutral throw for non-admins, same email on
// success. Used by the panel's guardian-resend action.
export const requireSuperAdminInAction = async (
  ctx: ActionCtx,
): Promise<string> =>
  ctx.runQuery(internal.lib.adminAuth.resolveSuperAdmin, {});

// A non-throwing check the /admin page uses to decide between the queues and the
// neutral "not available" state. This is a courtesy for the UI ONLY: every
// admin query/mutation still calls requireSuperAdmin server-side (criterion 1,
// deny-by-default). Returns false for a signed-out or non-allowlisted caller,
// never revealing the allowlist.
export const amISuperAdmin = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const email = await callerEmail(ctx);
    return isAllowedAdminEmail(process.env.SUPER_ADMIN_EMAILS, email);
  },
});
