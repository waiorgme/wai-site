// Guardian confirmation tokens (Stage 0 §4.3): the emailed link carries an
// unguessable one-time token; only its SHA-256 hash is stored. Pure helpers,
// unit-tested; the same code runs in the Convex runtime and in tests.

// 30 days to confirm, then the row is expired and the member re-sends.
export const GUARDIAN_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 128-bit random, hex (same strength as the certificate verify token).
export const generateGuardianToken = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

// SHA-256 hex of the token; the stored form. Web Crypto is available in the
// Convex runtime, Node 20+, and the browser alike.
export const hashGuardianToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};

export const isGuardianTokenExpired = (
  sentAt: number,
  now: number,
): boolean => now - sentAt >= GUARDIAN_TOKEN_TTL_MS;
