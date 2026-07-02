// Claim-wave pure logic (unit-tested, no deployment): legacy-number parsing,
// imported-row normalisation, minor suppression, the DOB mismatch rule, and
// the counter-floor rule. Sources: Migration & Claim-Wave Plan (Decision 1),
// Stage 0 §4.2 ImportedMember, audit register DATA-1.

import { ageInYears, isValidDob } from "./age";

// "WAIME-274" (any case, optional spaces) -> 274. Null when unparseable.
export const parseLegacyNumber = (raw: string | null | undefined): number | null => {
  if (!raw) {
    return null;
  }
  const m = String(raw).trim().match(/^WAIME[\s-]*(\d{1,6})$/i);
  if (m === null) {
    return null;
  }
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

// Normalise a birthday cell (ISO date, datetime, or empty) to YYYY-MM-DD or null.
export const normalizeBirthday = (
  raw: string | null | undefined,
  now: number,
): string | null => {
  if (!raw) {
    return null;
  }
  const s = String(raw).trim().slice(0, 10);
  return isValidDob(s, now) ? s : null;
};

// The under-18 hold-back: anyone whose known birthday makes them under 18
// TODAY is suppressed from the open claim wave (guardian route later).
export const isSuppressedMinor = (
  dobIso: string | null,
  now: number,
): boolean => dobIso !== null && ageInYears(dobIso, now) < 18;

// DOB mismatch rule (Stage 0 synthetic dataset: "name/DOB mismatch ->
// conflict"): a conflict exists only when BOTH sides have a DOB and they are
// different calendar dates. A missing side is never a conflict.
export const dobConflicts = (
  declared: string,
  onFile: string | null | undefined,
): boolean => Boolean(onFile) && declared !== onFile;

// Name signal: loose match for match_signals (never a conflict on its own).
const squash = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z؀-ۿ]/g, "");

export const namesRoughlyMatch = (
  declared: string,
  onFile: string,
): boolean => {
  const a = squash(declared);
  const b = squash(onFile);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
};

// DATA-1: the new-signup counter must sit above every legacy number so the
// two ranges can never collide. Import calls this with the highest legacy
// number seen; the floor leaves headroom for stragglers found later.
export const counterFloor = (maxLegacyNumber: number): number =>
  Math.max(maxLegacyNumber, 0) + 100;
