import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { convex } from "../portal/convex";
import { sendLinkErrorMessage } from "../portal/errors";
import { api } from "../../convex/_generated/api";
import { card, h1, input, linkBtn, muted, primaryBtn } from "../portal/ui";
import { ClaimConflictsQueue } from "./ClaimConflictsQueue";
import { PipelineReviewsQueue } from "./PipelineReviewsQueue";
import { PendingGuardiansQueue } from "./PendingGuardiansQueue";
import { DataRequestsQueue } from "./DataRequestsQueue";
import { AdminAuditLog } from "./AdminAuditLog";

// The /admin fallback UI (admin-panel spec). A distinct surface from /portal so
// a member-facing bug can never leak admin controls to an ordinary session. The
// server check (requireSuperAdmin) is what actually protects the data; the UI
// hiding below is a courtesy (criterion 1, deny-by-default).

export function AdminApp() {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthLoading>
        <div style={card}>
          <p style={muted}>Loading…</p>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <AdminSignIn />
      </Unauthenticated>
      <Authenticated>
        <AdminGate />
      </Authenticated>
    </ConvexAuthProvider>
  );
}

// Signed in, but only the two super admins see the queues. Everyone else gets a
// neutral "not available" state (the server refuses their queries regardless).
function AdminGate() {
  const isAdmin = useQuery(api.lib.adminAuth.amISuperAdmin);
  const { signOut } = useAuthActions();

  if (isAdmin === undefined) {
    return (
      <div style={card}>
        <p style={muted}>Loading…</p>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div style={card}>
        <h1 style={h1}>Not available</h1>
        <p style={muted}>
          This area is not available for your account. If you were looking for
          your membership, go to{" "}
          <a href="/portal" style={{ color: "var(--sky)" }}>
            the member portal
          </a>
          .
        </p>
        <button type="button" style={linkBtn} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18, width: "min(880px, 100%)" }}>
      <header style={{ display: "grid", gap: 6 }}>
        <h1 style={{ ...h1, fontSize: 28 }}>Admin</h1>
        <p style={muted}>
          The safe-actions fallback. Every change here asks you to confirm, and
          is recorded below.
        </p>
      </header>
      <ClaimConflictsQueue />
      <PipelineReviewsQueue />
      <PendingGuardiansQueue />
      <DataRequestsQueue />
      <AdminAuditLog />
      <button type="button" style={linkBtn} onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

// Same magic-link sign-in as the portal, redirecting back to /admin.
function AdminSignIn() {
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
      <h1 style={h1}>Admin sign-in</h1>
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
            await signIn("resend", { email, redirectTo: "/admin" });
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
    </div>
  );
}
