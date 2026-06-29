import { useState } from "react";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { convex } from "./convex";
import { card, dl, h1, input, linkBtn, muted, primaryBtn } from "./ui";

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
        <MemberPanel />
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
        Enter your email and we'll send you a secure sign-in link — no password
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
          } catch {
            setError("Something went wrong sending your link. Please try again.");
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

function MemberPanel() {
  const { signOut } = useAuthActions();
  const me = useQuery(api.members.getCurrentMember);
  const firstName = me?.name?.split(" ")[0];

  return (
    <div style={card}>
      <h1 style={h1}>Welcome{firstName ? `, ${firstName}` : ""}</h1>
      {me === undefined ? (
        <p style={muted}>Loading your profile…</p>
      ) : me === null ? (
        <p style={muted}>
          You're signed in, but there's no member profile linked to this email
          yet.
        </p>
      ) : (
        <dl style={dl}>
          <Row label="Email" value={me.email} />
          <Row label="Status" value={me.lifecycle_state} />
          <Row label="Access lane" value={me.member_lane} />
        </dl>
      )}
      <button type="button" style={linkBtn} onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <dt style={{ color: "var(--mist)", opacity: 0.7 }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          color: "var(--white)",
          fontFamily: "var(--mono)",
          fontSize: 14,
        }}
      >
        {value}
      </dd>
    </div>
  );
}
