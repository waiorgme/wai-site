import { describe, expect, it } from "vitest";
import { fullName, isValidNamePart, nameCase } from "../../convex/lib/names";

describe("nameCase (PRD §6.2 name-aware Title Case)", () => {
  it("handles the PRD's own examples", () => {
    expect(nameCase("al-sayegh")).toBe("Al-Sayegh");
    expect(nameCase("o'brien")).toBe("O'Brien");
    expect(nameCase("mckenzie")).toBe("McKenzie");
    expect(nameCase("bint rashid")).toBe("bint Rashid");
    expect(nameCase("sherbaji-khan")).toBe("Sherbaji-Khan");
  });

  it("normalises case and whitespace", () => {
    expect(nameCase("  SARA  ")).toBe("Sara");
    expect(nameCase("sara   ahmed")).toBe("Sara Ahmed");
    expect(nameCase("MARIA DE SILVA")).toBe("Maria de Silva");
  });

  it("keeps Arabic name particles lowercase", () => {
    expect(nameCase("abd al rahman")).toBe("abd al Rahman");
    expect(nameCase("noor bint khalid")).toBe("noor bint Khalid".replace("noor", "Noor"));
  });

  it("fullName combines and cases both parts", () => {
    expect(fullName("sara", "sherbaji-khan")).toBe("Sara Sherbaji-Khan");
  });
});

describe("isValidNamePart", () => {
  it("accepts real names", () => {
    expect(isValidNamePart("Sara")).toBe(true);
    expect(isValidNamePart("Al-Sayegh")).toBe(true);
    expect(isValidNamePart("O'Brien")).toBe(true);
    expect(isValidNamePart("bint Rashid")).toBe(true);
  });

  it("rejects sentences, digits, non-Latin and junk", () => {
    expect(isValidNamePart("I would like to join your organisation please")).toBe(false);
    expect(isValidNamePart("Sara123")).toBe(false);
    expect(isValidNamePart("سارة")).toBe(false);
    expect(isValidNamePart("a")).toBe(false);
    expect(isValidNamePart("")).toBe(false);
    expect(isValidNamePart("x".repeat(41))).toBe(false);
  });
});
