import { describe, expect, it } from "vitest";
import {
  GUARDIAN_TOKEN_TTL_MS,
  generateGuardianToken,
  hashGuardianToken,
  isGuardianTokenExpired,
} from "../../convex/lib/guardianToken";

describe("guardian tokens (Stage 0 §4.3: unguessable, hashed at rest)", () => {
  it("generates 128-bit hex tokens, unique per call", () => {
    const a = generateGuardianToken();
    const b = generateGuardianToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically to SHA-256 hex, never the token itself", async () => {
    const token = "a".repeat(32);
    const hash = await hashGuardianToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(await hashGuardianToken(token)).toBe(hash);
    expect(await hashGuardianToken("b".repeat(32))).not.toBe(hash);
  });

  it("expires exactly at the 30-day boundary", () => {
    const sent = 1_000_000;
    expect(isGuardianTokenExpired(sent, sent + GUARDIAN_TOKEN_TTL_MS - 1)).toBe(false);
    expect(isGuardianTokenExpired(sent, sent + GUARDIAN_TOKEN_TTL_MS)).toBe(true);
  });
});
