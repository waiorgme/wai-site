// Fixed-window rate limiting: pure window logic (unit-testable) + the limit
// policy for magic-link sends. One choke point covers both the join flow and
// the portal sign-in, because every sign-in email goes through the Resend
// provider's sendVerificationRequest.
//
// Policy source: the audit register (SEC-2) and the Send Limits decision
// ([[02 Send Limits]]): Resend free tier caps at 100 emails/day, so an
// unthrottled endpoint lets one attacker burn the whole daily budget and lock
// real members out of signing in. The global cap also bounds the blast radius
// of any future misconfiguration, whatever the Resend plan.

export type RateLimitRule = {
  /** Max events per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
};

// Per email address: 3 sends per hour, 10 per 24 hours. Numbers are the
// vault's, verbatim (Stage 0 §8: "Resend: rate-limited to 3 per email per
// hour, 10/day").
export const PER_EMAIL_SHORT: RateLimitRule = { limit: 3, windowMs: 60 * 60 * 1000 };
export const PER_EMAIL_DAY: RateLimitRule = { limit: 10, windowMs: 24 * 60 * 60 * 1000 };
// Across everyone: 90 sends per 24 hours, deliberately BELOW Resend's
// free-tier hard cap of 100/day ([[02 Email Send Limits - Free-Tier Check]]).
// The app cap must trip first: our refusal is transactional and preserves any
// live link, while an upstream refusal happens after the code swap and would
// burn it. Raise only once Resend Pro is confirmed active (owner item).
export const GLOBAL_DAY: RateLimitRule = { limit: 90, windowMs: 24 * 60 * 60 * 1000 };

export type WindowState = { window_start: number; count: number };

export type WindowDecision = {
  allowed: boolean;
  /** The state to persist (only meaningful when allowed). */
  next: WindowState;
  /** When a blocked caller may retry, in ms from now (only when blocked). */
  retryAfterMs: number;
};

// Decide whether one more event fits in the fixed window. If the stored window
// has expired, a fresh window starts at `now`.
export const decideWindow = (
  state: WindowState | null,
  rule: RateLimitRule,
  now: number,
): WindowDecision => {
  if (state === null || now - state.window_start >= rule.windowMs) {
    return {
      allowed: true,
      next: { window_start: now, count: 1 },
      retryAfterMs: 0,
    };
  }
  if (state.count < rule.limit) {
    return {
      allowed: true,
      next: { window_start: state.window_start, count: state.count + 1 },
      retryAfterMs: 0,
    };
  }
  return {
    allowed: false,
    next: state,
    retryAfterMs: state.window_start + rule.windowMs - now,
  };
};

// The error message thrown across the wire when a limit trips. The client
// matches on this marker to show the plain-language "wait and retry" copy.
export const RATE_LIMITED_MARKER = "rate_limited";
