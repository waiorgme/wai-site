import { ConvexError } from "convex/values";

// Maps server errors to member-facing copy. The rate limiter (SEC-2) throws
// ConvexError("rate_limited") - ConvexError because plain Error messages are
// redacted on production deployments. Plain language, hyphens only (brand lock).

const isRateLimited = (err: unknown): boolean =>
  (err instanceof ConvexError && err.data === "rate_limited") ||
  String(err).includes("rate_limited");

const RATE_LIMIT_COPY =
  "You have asked for a few sign-in links in a row. To keep accounts safe we pause sending for a short while. Please try again in about an hour. If it still does not work, try again tomorrow.";

// For the portal sign-in form, where every failure is about sending the link.
export const sendLinkErrorMessage = (err: unknown): string =>
  isRateLimited(err)
    ? RATE_LIMIT_COPY
    : "Something went wrong sending your link. Please try again.";

// For the Join form, where the failure may be the sign-up itself, not the
// link, so the fallback stays generic.
export const joinErrorMessage = (err: unknown): string =>
  isRateLimited(err) ? RATE_LIMIT_COPY : "Something went wrong. Please try again.";
