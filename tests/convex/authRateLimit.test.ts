import { convexTest } from "convex-test";
import { sha256 as rawSha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// SEC-2 regression (Codex Gate 4 blocker): the send limits must run INSIDE the
// transaction that replaces the stored verification code. If they ran after it
// (the original placement, in sendVerificationRequest), an attacker pumping
// requests for a member's email would delete her already-emailed link on every
// over-limit attempt without sending a replacement: a targeted sign-in denial.
// These tests drive the real signIn action end to end with only Resend mocked.

const modules = import.meta.glob("../../convex/**/*.*s");

// Captured outgoing emails; the Resend SDK is the only thing mocked.
const sentEmails: Array<{ to: string[]; text: string }> = [];
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (args: { to: string[]; text: string }) => {
        sentEmails.push(args);
        return { error: null };
      },
    };
  },
}));

// Same encoding the library uses to store codes (utils.js sha256).
const sha256Hex = (input: string): string =>
  encodeHexLowerCase(rawSha256(new TextEncoder().encode(input)));

const codeFromEmail = (email: { text: string }): string => {
  const url = /https?:\/\/\S+/.exec(email.text)?.[0];
  const code = url === undefined ? null : new URL(url).searchParams.get("code");
  if (code === null) {
    throw new Error("No sign-in link in the captured email");
  }
  return code;
};

process.env.SITE_URL = "http://localhost:4321";
process.env.AUTH_RESEND_KEY = "test-key";

const EMAIL = "member@example.com";

beforeEach(() => {
  sentEmails.length = 0;
});

describe("magic-link send limits (SEC-2)", () => {
  it("allows 3 sends per 15 minutes, then blocks with the rate_limited marker", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 3; i++) {
      await t.action(api.auth.signIn, {
        provider: "resend",
        params: { email: EMAIL },
      });
    }
    expect(sentEmails).toHaveLength(3);

    await expect(
      t.action(api.auth.signIn, {
        provider: "resend",
        params: { email: EMAIL },
      }),
    ).rejects.toThrow(/rate_limited/);
    expect(sentEmails).toHaveLength(3);
  });

  it("an over-limit request does NOT invalidate the member's live link", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 3; i++) {
      await t.action(api.auth.signIn, {
        provider: "resend",
        params: { email: EMAIL },
      });
    }
    const liveCode = codeFromEmail(sentEmails[2]);

    await expect(
      t.action(api.auth.signIn, {
        provider: "resend",
        params: { email: EMAIL },
      }),
    ).rejects.toThrow(/rate_limited/);

    // The stored verification code is still exactly the one from the last
    // allowed send: not deleted, not replaced. The emailed link still works.
    const codes = await t.run(async (ctx) =>
      ctx.db.query("authVerificationCodes").collect(),
    );
    expect(codes).toHaveLength(1);
    expect(codes[0].code).toBe(sha256Hex(liveCode));
  });

  it("limits are per email address, not global, below the global cap", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 3; i++) {
      await t.action(api.auth.signIn, {
        provider: "resend",
        params: { email: EMAIL },
      });
    }
    // A different member is unaffected by the first member's window.
    await t.action(api.auth.signIn, {
      provider: "resend",
      params: { email: "other@example.com" },
    });
    expect(sentEmails).toHaveLength(4);
  });
});
