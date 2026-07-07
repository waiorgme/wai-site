import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { convex } from "./convex";
import { sendLinkErrorMessage } from "./errors";
import { Dashboard } from "./Dashboard";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  card,
  errorText,
  h1,
  hint,
  input,
  linkBtn,
  muted,
  primaryBtn,
} from "./ui";

export function PortalApp() {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthLoading>
        <div className="pn-center">
          <Brand />
          <div className={card}>
            <p className="pn-eyebrow on-paper">Member portal</p>
            <p className={muted}>Loading…</p>
          </div>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <ErrorBoundary
          fallback={
            <div className="pn-center">
              <Brand />
              <div className={card}>
                <p className="pn-eyebrow on-paper">Member portal</p>
                <h1 className={h1}>Something went wrong</h1>
                <p className={muted}>
                  Something went wrong on our side. Reload the page, or email{" "}
                  <a href="mailto:support@waiorg.me">support@waiorg.me</a> and we
                  will sort it out together.
                </p>
                <button
                  type="button"
                  className={linkBtn}
                  onClick={() => window.location.reload()}
                >
                  Reload the page
                </button>
              </div>
            </div>
          }
        >
          <Dashboard />
        </ErrorBoundary>
      </Authenticated>
    </ConvexAuthProvider>
  );
}

// The light logo row above centered cards (the panel system's brand mark on paper).
function Brand() {
  return (
    <div className="pn-brand">
      <img src="/assets/wai-me-logo.png" alt="Women in Aviation Middle East" />
    </div>
  );
}

function SignIn() {
  const { signIn } = useAuthActions();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sentTo !== null) {
    return (
      <div className="pn-center">
        <Brand />
        <div className={card}>
          <p className="pn-eyebrow on-paper">Member portal</p>
          <h1 className={h1}>Check your email</h1>
          <p className={muted}>
            We sent a sign-in link to <strong>{sentTo}</strong>. It expires
            in 15 minutes and can be used once.
          </p>
          <button type="button" className={linkBtn} onClick={() => setSentTo(null)}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pn-center">
      <Brand />
      <div className={card}>
        <p className="pn-eyebrow on-paper">Member portal</p>
        <h1 className={h1}>Member sign-in</h1>
        <p className={muted}>
          Enter your email and we'll send you a secure sign-in link - no password
          needed.
        </p>
        <form
          className="pn-stack"
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
            aria-label="Email address"
            placeholder="you@example.com"
            className={input}
          />
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
          {error !== null && <p className={errorText}>{error}</p>}
        </form>
        <p className={hint}>
          New to WAI-ME? <a href="/join">Join here</a>.
        </p>
      </div>
    </div>
  );
}
