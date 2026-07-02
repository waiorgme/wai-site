import { describe, expect, it } from "vitest";
import {
  ageInYears,
  computeMinorUntil,
  deriveAgeBlock,
  isValidDob,
  meetsMinimumJoinAge,
} from "../../convex/lib/age";

// A fixed "now": 2026-07-02T12:00:00Z.
const NOW = Date.UTC(2026, 6, 2, 12);

describe("ageInYears", () => {
  it("counts full years only", () => {
    expect(ageInYears("2000-07-02", NOW)).toBe(26);
    expect(ageInYears("2000-07-03", NOW)).toBe(25);
  });

  it("handles the day-before-birthday boundary", () => {
    // 18th birthday is tomorrow: still 17 today.
    expect(ageInYears("2008-07-03", NOW)).toBe(17);
    // 18th birthday is today: 18.
    expect(ageInYears("2008-07-02", NOW)).toBe(18);
  });
});

describe("computeMinorUntil", () => {
  it("is the 18th birthday", () => {
    expect(computeMinorUntil("2010-03-15")).toBe("2028-03-15");
  });
});

describe("isValidDob (SEC-1)", () => {
  it("accepts a real ISO date in range", () => {
    expect(isValidDob("1990-01-31", NOW)).toBe(true);
    expect(isValidDob("2010-02-28", NOW)).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidDob("", NOW)).toBe(false);
    expect(isValidDob("31/01/1990", NOW)).toBe(false);
    expect(isValidDob("1990-1-31", NOW)).toBe(false);
    expect(isValidDob("not-a-date", NOW)).toBe(false);
  });

  it("rejects impossible calendar dates (no overflow normalisation)", () => {
    expect(isValidDob("2001-02-31", NOW)).toBe(false);
    expect(isValidDob("2001-13-01", NOW)).toBe(false);
  });

  it("rejects future dates and pre-1900 dates", () => {
    expect(isValidDob("2027-01-01", NOW)).toBe(false);
    expect(isValidDob("1899-12-31", NOW)).toBe(false);
  });
});

describe("meetsMinimumJoinAge (13+ vault lock)", () => {
  it("rejects an under-13 applicant", () => {
    // 12 years old today.
    expect(meetsMinimumJoinAge("2014-01-15", NOW)).toBe(false);
    // 13th birthday is tomorrow: still 12 today.
    expect(meetsMinimumJoinAge("2013-07-03", NOW)).toBe(false);
  });

  it("accepts from the 13th birthday itself", () => {
    // 13th birthday is today.
    expect(meetsMinimumJoinAge("2013-07-02", NOW)).toBe(true);
    // Comfortably a teenager and an adult.
    expect(meetsMinimumJoinAge("2010-01-15", NOW)).toBe(true);
    expect(meetsMinimumJoinAge("1990-01-15", NOW)).toBe(true);
  });
});

describe("deriveAgeBlock", () => {
  it("no DOB means unknown age, nothing pending", () => {
    const block = deriveAgeBlock(undefined, NOW);
    expect(block.age_confidence).toBe("unknown");
    expect(block.date_of_birth_source).toBe("unknown");
    expect(block.minor_until).toBeUndefined();
    expect(block.guardian_consent_state).toBe("not_required");
  });

  it("a minor's DOB sets minor_until and pending guardian consent", () => {
    const block = deriveAgeBlock("2010-01-15", NOW);
    expect(block.age_confidence).toBe("declared");
    expect(block.minor_until).toBe("2028-01-15");
    expect(block.guardian_consent_state).toBe("pending");
  });

  it("an adult's DOB needs no guardian consent", () => {
    const block = deriveAgeBlock("1990-01-15", NOW);
    expect(block.age_confidence).toBe("declared");
    expect(block.minor_until).toBeUndefined();
    expect(block.guardian_consent_state).toBe("not_required");
  });
});
