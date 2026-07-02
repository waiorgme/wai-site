// Age helpers used by the lane evaluator and the join flow. Pure functions so
// they are unit-testable without a deployment (synthetic dataset, Stage 0 §9).

export const ageInYears = (dobIso: string, now: number): number => {
  const dob = new Date(dobIso);
  const ref = new Date(now);
  let age = ref.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = ref.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
};

export const computeMinorUntil = (dobIso: string): string => {
  const d = new Date(dobIso);
  d.setUTCFullYear(d.getUTCFullYear() + 18);
  return d.toISOString().slice(0, 10);
};

// SEC-1: boundary validation for a self-declared DOB. ISO YYYY-MM-DD, a real
// calendar date, not in the future, not before 1900. The public join flow
// REQUIRES a valid DOB; only the internal migration path may omit one.
export const isValidDob = (dob: string, now: number): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return false;
  }
  const parsed = new Date(`${dob}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  // Reject normalised overflow like 2001-02-31 -> 2001-03-03.
  if (parsed.toISOString().slice(0, 10) !== dob) {
    return false;
  }
  const year = parsed.getUTCFullYear();
  return year >= 1900 && parsed.getTime() <= now;
};

// Vault lock: minimum joining age is 13; under-13s are never signed up as
// their own members ([[01 Under-18 Members & Mentorship Safeguards (Decision)]]).
export const MIN_JOIN_AGE = 13;

// True when a (valid) DOB meets the 13+ floor on the reference day. The 13th
// birthday itself is eligible.
export const meetsMinimumJoinAge = (dobIso: string, now: number): boolean =>
  ageInYears(dobIso, now) >= MIN_JOIN_AGE;

type AgeBlock = {
  date_of_birth: string | undefined;
  date_of_birth_source: "self_declared" | "migrated" | "guardian_confirmed" | "unknown";
  age_confidence: "confirmed" | "declared" | "unknown";
  minor_until: string | undefined;
  guardian_consent_state: "not_required" | "pending" | "confirmed";
};

// A self-declared DOB is "declared", not "confirmed". No DOB → unknown, which
// the lane evaluator treats as restricted_unknown (Codex 7).
export const deriveAgeBlock = (
  dobAnswer: string | undefined,
  now: number,
): AgeBlock => {
  if (!dobAnswer) {
    return {
      date_of_birth: undefined,
      date_of_birth_source: "unknown",
      age_confidence: "unknown",
      minor_until: undefined,
      guardian_consent_state: "not_required",
    };
  }
  const isMinor = ageInYears(dobAnswer, now) < 18;
  return {
    date_of_birth: dobAnswer,
    date_of_birth_source: "self_declared",
    age_confidence: "declared",
    minor_until: isMinor ? computeMinorUntil(dobAnswer) : undefined,
    guardian_consent_state: isMinor ? "pending" : "not_required",
  };
};
