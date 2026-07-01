// Maps server errors to member-facing copy. The rate limiter (SEC-2) throws
// a "rate_limited" marker; everything else gets the generic retry line.
// Plain language, no jargon, hyphens only (brand lock).

export const sendLinkErrorMessage = (err: unknown): string =>
  String(err).includes("rate_limited")
    ? "You have asked for a few sign-in links in a row. To keep accounts safe we pause sending for a short while. Please wait 15 minutes and try again."
    : "Something went wrong sending your link. Please try again.";
