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

  it("rejects short sentence fragments and padded phrases (adversarial)", () => {
    expect(isValidNamePart("I am here")).toBe(false); // 1-char word
    expect(isValidNamePart("please add me now")).toBe(false); // 4 words
    expect(isValidNamePart("please join me")).toBe(false); // filler words
    expect(isValidNamePart("add me here")).toBe(false); // filler words
    expect(isValidNamePart("test")).toBe(false); // filler word
    // A rare-word 3-word phrase can still pass any structural rule; the
    // certificate confirm step is the human backstop for those.
  });

  it("rejects three plain words with no name particle (sentence-shaped)", () => {
    expect(isValidNamePart("aviation opens doors")).toBe(false);
    expect(isValidNamePart("flying feels great")).toBe(false);
    // Particle-anchored three-word parts remain valid names.
    expect(isValidNamePart("de la Cruz")).toBe(true);
    expect(isValidNamePart("abd al Rahman")).toBe(true);
  });

  it("rejects trailing or leading separators", () => {
    expect(isValidNamePart("Sara-")).toBe(false);
    expect(isValidNamePart("O'Brien'")).toBe(false);
    expect(isValidNamePart("-Sara")).toBe(false);
  });

  it("still accepts real multi-word name parts", () => {
    expect(isValidNamePart("de la Cruz")).toBe(true);
    expect(isValidNamePart("bint Rashid")).toBe(true);
  });

  it("rejects doubled punctuation", () => {
    expect(isValidNamePart("Sara--Jane")).toBe(false);
    expect(isValidNamePart("O''Brien")).toBe(false);
  });
});
