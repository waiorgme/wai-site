import { describe, expect, it } from "vitest";
import {
  dobGate,
  isValidCareerStage,
  isValidCountry,
  isValidGuardianName,
  isValidJoinEmail,
  isValidLookingFor,
  normalizeEmail,
} from "../../convex/lib/joinValidation";
import { COUNTRIES } from "../../convex/lib/countries";
import { CAREER_STAGES } from "../../convex/lib/profile";

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

  it("looking-for rejects duplicate options (padding)", () => {
    expect(isValidLookingFor(["Jobs", "Jobs"])).toBe(false);
  });
});

describe("career stage (server-side, against CAREER_STAGES)", () => {
  it("accepts only the five public options", () => {
    for (const stage of CAREER_STAGES) {
      expect(isValidCareerStage(stage)).toBe(true);
    }
    expect(isValidCareerStage("student")).toBe(false);
    expect(isValidCareerStage("")).toBe(false);
    expect(isValidCareerStage("x".repeat(200))).toBe(false);
  });
});

describe("guardian name (adversarial payloads)", () => {
  it("accepts a real guardian full name", () => {
    expect(isValidGuardianName("Mona Al-Sayegh")).toBe(true);
    expect(isValidGuardianName("Ahmed bin Rashid al Maktoum")).toBe(true);
  });

  it("rejects junk, digits, scripts and over-long strings", () => {
    expect(isValidGuardianName("")).toBe(false);
    expect(isValidGuardianName("x")).toBe(false);
    expect(isValidGuardianName("Mona123")).toBe(false);
    expect(isValidGuardianName("<script>alert(1)</script>")).toBe(false);
    expect(isValidGuardianName("m".repeat(81))).toBe(false);
    expect(isValidGuardianName("I am the guardian of this child ok")).toBe(false);
  });
});
