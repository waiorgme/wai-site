import { describe, expect, it } from "vitest";
import {
  dobGate,
  isValidCountry,
  isValidJoinEmail,
  isValidLookingFor,
  normalizeEmail,
} from "../../convex/lib/joinValidation";
import { COUNTRIES } from "../../convex/lib/countries";

const NOW = Date.UTC(2026, 6, 2, 12);

describe("isValidJoinEmail", () => {
  it("accepts a normal address and normalises case", () => {
    expect(isValidJoinEmail("Sara@Example.com")).toBe(true);
    expect(normalizeEmail("  Sara@Example.com ")).toBe("sara@example.com");
  });

  it("rejects malformed addresses", () => {
    expect(isValidJoinEmail("not-an-email")).toBe(false);
    expect(isValidJoinEmail("a b@c.com")).toBe(false);
    expect(isValidJoinEmail("a@b")).toBe(false);
    expect(isValidJoinEmail("")).toBe(false);
  });

  it("rejects disposable domains (PRD §6.2)", () => {
    expect(isValidJoinEmail("bot@mailinator.com")).toBe(false);
    expect(isValidJoinEmail("bot@YOPmail.com")).toBe(false);
  });
});

describe("dobGate (min age 13, guardian branch 13-17)", () => {
  it("classifies adult, minor, under-13 and invalid", () => {
    expect(dobGate("1990-05-10", NOW)).toBe("adult");
    expect(dobGate("2010-05-10", NOW)).toBe("minor");
    expect(dobGate("2015-05-10", NOW)).toBe("under_13");
    expect(dobGate("13/05/2010", NOW)).toBe("invalid");
  });

  it("boundaries: 13th and 18th birthdays flip the gate on the day", () => {
    expect(dobGate("2013-07-02", NOW)).toBe("minor"); // 13 today
    expect(dobGate("2013-07-03", NOW)).toBe("under_13"); // 13 tomorrow
    expect(dobGate("2008-07-02", NOW)).toBe("adult"); // 18 today
    expect(dobGate("2008-07-03", NOW)).toBe("minor"); // 18 tomorrow
  });
});

describe("country + looking-for lists", () => {
  it("accepts list values only", () => {
    expect(isValidCountry("United Arab Emirates")).toBe(true);
    expect(isValidCountry("Atlantis")).toBe(false);
    expect(COUNTRIES[0]).toBe("United Arab Emirates"); // home region first
  });

  it("looking-for must come from the profile field spec options", () => {
    expect(isValidLookingFor(["Jobs", "Networking"])).toBe(true);
    expect(isValidLookingFor([])).toBe(true);
    expect(isValidLookingFor(["World domination"])).toBe(false);
  });
});
