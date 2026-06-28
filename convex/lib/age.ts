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
