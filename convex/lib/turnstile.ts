// §1 Bot protection: server-side Cloudflare Turnstile verification. Extracted
// here so the join flow and the data-request submission share ONE verifier
// (the admin-panel spec: reuse the existing Turnstile helper, do not fork a
// second one). The secret is deployment config (TURNSTILE_SECRET_KEY); fail
// closed when unset.
export const verifyTurnstile = async (token: string): Promise<boolean> => {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret === undefined) {
    return false;
  }
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    },
  );
  const data = (await res.json()) as { success: boolean };
  return data.success === true;
};
