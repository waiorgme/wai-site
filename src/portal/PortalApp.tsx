import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { convex } from "./convex";
import { sendLinkErrorMessage } from "./errors";
import { Dashboard } from "./Dashboard";
import { card, h1, input, linkBtn, muted, primaryBtn } from "./ui";

export function PortalApp() {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthLoading>
        <div style={card}>
          <p style={muted}>Loading…</p>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Dashboard />
      </Authenticated>
    </ConvexAuthProvider>
  );
}

function SignIn() {
  const { signIn } = useAuthActions();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sentTo !== null) {
    return (
      <div style={card}>
        <h1 style={h1}>Check your email</h1>
        <p style={muted}>
          We sent a sign-in link to{" "}
          <strong style={{ color: "var(--white)" }}>{sentTo}</strong>. It expires
          in 15 minutes and can be used once.
        </p>
        <button type="button" style={linkBtn} onClick={() => setSentTo(null)}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div style={card}>
      <h1 style={h1}>Member sign-in</h1>
      <p style={muted}>
        Enter your email and we'll send you a secure sign-in link - no password
        needed.
      </p>
      <form
        style={{ display: "grid", gap: 12, marginTop: 8 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const email = String(
            new FormData(event.currentTarget).get("email") ?? "",
          ).trim();
          if (email === "") {
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await signIn("resend", { email, redirectTo: "/portal" });
            setSentTo(email);
          } catch (err) {
            setError(sendLinkErrorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          style={input}
        />
        <button type="submit" disabled={busy} style={primaryBtn}>
          {busy ? "Sending…" : "Send sign-in link"}
        </button>
        {error !== null && <p style={{ ...muted, color: "#ff9b9b" }}>{error}</p>}
      </form>
      <p style={{ ...muted, fontSize: 13 }}>
        New to WAI-ME? <a href="/join" style={{ color: "var(--sky)" }}>Join here</a>.
      </p>
    </div>
  );
}
