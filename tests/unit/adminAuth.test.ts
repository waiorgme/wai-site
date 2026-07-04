import { describe, expect, it } from "vitest";
import {
  isAllowedAdminEmail,
  parseAllowlist,
} from "../../convex/lib/adminAuth";
import { maskName } from "../../convex/lib/adminMask";

// Admin allowlist logic (spec criterion 11): allowed email, case-insensitivity,
// empty/unset allowlist denies, a signed-in-but-not-listed caller denies.

describe("parseAllowlist", () => {
  it("splits, trims, lower-cases and drops blanks", () => {
    expect(parseAllowlist(" Mervat@Example.com , issam@example.com ,")).toEqual([
      "mervat@example.com",
      "issam@example.com",
    ]);
  });
  it("returns [] for unset or empty", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("")).toEqual([]);
    expect(parseAllowlist("   ,  ")).toEqual([]);
  });
});

describe("isAllowedAdminEmail", () => {
  const allow = "mervat@example.com,issam@example.com";

  it("allows a listed email regardless of case", () => {
    expect(isAllowedAdminEmail(allow, "ISSAM@example.com")).toBe(true);
    expect(isAllowedAdminEmail(allow, "mervat@example.com")).toBe(true);
  });
  it("denies an email not on the list", () => {
    expect(isAllowedAdminEmail(allow, "someone@example.com")).toBe(false);
  });
  it("denies a signed-in caller with no member email (null)", () => {
    expect(isAllowedAdminEmail(allow, null)).toBe(false);
    expect(isAllowedAdminEmail(allow, "")).toBe(false);
  });
  it("deny-by-default: unset or empty allowlist denies everyone", () => {
    expect(isAllowedAdminEmail(undefined, "mervat@example.com")).toBe(false);
    expect(isAllowedAdminEmail("", "mervat@example.com")).toBe(false);
  });
});

describe("maskName (PII minimisation on read surfaces)", () => {
  it("returns first name + last initial", () => {
    expect(maskName("Amira Al Farsi")).toBe("Amira F.");
    expect(maskName("Sara Hassan")).toBe("Sara H.");
  });
  it("returns a single name unchanged", () => {
    expect(maskName("Amira")).toBe("Amira");
  });
  it("never renders blank", () => {
    expect(maskName("   ")).toBe("(unnamed)");
  });
});
