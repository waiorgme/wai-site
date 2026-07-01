// Server-side validation for the public Join form (PRD §6.2). Pure functions,
// unit-tested. Everything here runs at the submitJoin boundary; the client
// mirrors the friendly parts but is never the enforcement layer.

import { ageInYears, isValidDob, MIN_JOIN_AGE } from "./age";
import { LOOKING_FOR } from "./profile";
import { COUNTRIES } from "./countries";

export const EMAIL_MAX = 254;

// Well-formed email: one @, a dot in the domain, no whitespace. Deliberately
// simple; the magic link is the real verification.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Disposable-address domains (PRD §6.2 "reject disposable domains"). A small,
// high-signal deny-list; extend as abuse appears.
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "yopmail.com", "sharklasers.com", "getnada.com",
  "trashmail.com", "dispostable.com", "maildrop.cc", "fakeinbox.com",
  "throwawaymail.com", "mytemp.email", "mailnesia.com",
]);

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

export const isValidJoinEmail = (raw: string): boolean => {
  const email = normalizeEmail(raw);
  if (email.length === 0 || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return false;
  }
  const domain = email.split("@")[1];
  return !DISPOSABLE_DOMAINS.has(domain);
};

// The 13+ floor lives in lib/age.ts (single source); re-exported for callers.
export { MIN_JOIN_AGE } from "./age";

// DOB gate: "invalid" (malformed), "under_13" (refused gently), "minor"
// (13-17, guardian branch), "adult".
export type DobGate = "invalid" | "under_13" | "minor" | "adult";

export const dobGate = (dob: string, now: number): DobGate => {
  if (!isValidDob(dob, now)) {
    return "invalid";
  }
  const age = ageInYears(dob, now);
  if (age < MIN_JOIN_AGE) {
    return "under_13";
  }
  return age < 18 ? "minor" : "adult";
};

export const isValidCountry = (c: string): boolean => COUNTRIES.includes(c);

export const isValidLookingFor = (values: string[]): boolean =>
  values.length <= LOOKING_FOR.length &&
  values.every((v) => (LOOKING_FOR as readonly string[]).includes(v));
