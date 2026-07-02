import { describe, expect, it } from "vitest";
import {
  counterFloor,
  dobConflicts,
  isSuppressedMinor,
  namesRoughlyMatch,
  normalizeBirthday,
  parseLegacyNumber,
} from "../../convex/lib/claim";

const NOW = Date.UTC(2026, 6, 2, 12);

describe("parseLegacyNumber (WAIME-### -> number)", () => {
  it("parses the cleaned-list format", () => {
    expect(parseLegacyNumber("WAIME-274")).toBe(274);
    expect(parseLegacyNumber("waime-1309")).toBe(1309);
    expect(parseLegacyNumber(" WAIME 42 ")).toBe(42);
  });

  it("rejects junk", () => {
    expect(parseLegacyNumber("274")).toBeNull();
    expect(parseLegacyNumber("WAIME-")).toBeNull();
    expect(parseLegacyNumber("")).toBeNull();
    expect(parseLegacyNumber(undefined)).toBeNull();
    expect(parseLegacyNumber("MEMBER-274")).toBeNull();
  });
});

describe("normalizeBirthday", () => {
  it("keeps valid ISO dates, truncates datetimes", () => {
    expect(normalizeBirthday("1990-05-10", NOW)).toBe("1990-05-10");
    expect(normalizeBirthday("1990-05-10 00:00:00", NOW)).toBe("1990-05-10");
  });

  it("drops junk, future dates, and pre-1900", () => {
    expect(normalizeBirthday("10/05/1990", NOW)).toBeNull();
    expect(normalizeBirthday("2030-01-01", NOW)).toBeNull();
    expect(normalizeBirthday("1899-01-01", NOW)).toBeNull();
    expect(normalizeBirthday(null, NOW)).toBeNull();
  });
});

describe("isSuppressedMinor (under-18 hold-back)", () => {
  it("suppresses only known minors", () => {
    expect(isSuppressedMinor("2010-01-01", NOW)).toBe(true);
    expect(isSuppressedMinor("1990-01-01", NOW)).toBe(false);
    expect(isSuppressedMinor(null, NOW)).toBe(false); // unknown age is NOT suppressed
  });

  it("18th birthday today is not suppressed", () => {
    expect(isSuppressedMinor("2008-07-02", NOW)).toBe(false);
    expect(isSuppressedMinor("2008-07-03", NOW)).toBe(true);
  });
});

describe("dobConflicts (mismatch -> human review)", () => {
  it("conflicts only when both sides exist and differ", () => {
    expect(dobConflicts("1990-05-10", "1990-05-10")).toBe(false);
    expect(dobConflicts("1990-05-10", "1991-05-10")).toBe(true);
    expect(dobConflicts("1990-05-10", null)).toBe(false);
    expect(dobConflicts("1990-05-10", undefined)).toBe(false);
  });
});

describe("namesRoughlyMatch (signal only, never a conflict)", () => {
  it("tolerates case, spacing, punctuation, and partial forms", () => {
    expect(namesRoughlyMatch("Sara Al-Sayegh", "sara alsayegh")).toBe(true);
    expect(namesRoughlyMatch("Sara", "Sara Al-Sayegh")).toBe(true);
    expect(namesRoughlyMatch("Amal Haddad", "Nour Kassem")).toBe(false);
    expect(namesRoughlyMatch("", "Sara")).toBe(false);
  });
});

describe("counterFloor (DATA-1: no collisions with legacy numbers)", () => {
  it("sits above the highest legacy number with headroom", () => {
    expect(counterFloor(1309)).toBe(1409);
    expect(counterFloor(0)).toBe(100);
    expect(counterFloor(-5)).toBe(100);
  });
});
