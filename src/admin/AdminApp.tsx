import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { convex } from "../portal/convex";
import { sendLinkErrorMessage } from "../portal/errors";
import { api } from "../../convex/_generated/api";
import type { AdminOverviewCounts } from "../../convex/admin/overview";
import { card, errorText, h1, input, linkBtn, muted, primaryBtn } from "../portal/ui";
import { queueSection, queueTitle, rowMeta } from "./ui";
import { ClaimConflictsQueue } from "./ClaimConflictsQueue";
import { PipelineReviewsQueue } from "./PipelineReviewsQueue";
import { PendingGuardiansQueue } from "./PendingGuardiansQueue";
import { DataRequestsQueue } from "./DataRequestsQueue";
import { AdminAuditLog } from "./AdminAuditLog";

// The /admin fallback UI (admin-panel spec). A distinct surface from /portal so
// a member-facing bug can never leak admin controls to an ordinary session. The
// server check (requireSuperAdmin) is what actually protects the data; the UI
// hiding below is a courtesy (criterion 1, deny-by-default).
//
// panel-design slice: the console shell (spec criteria 8-9). One island, no
// routing - a sidebar of local-state views (Overview, the four queues by their
// exact names, the audit log, honest Soon seams) over the locked light system:
// navy hero band, paper main, zero gold.

export function AdminApp() {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthLoading>
        <Centered>
          <div className={card}>
            <p className="pn-eyebrow on-paper">Admin console</p>
            <p className={muted}>Loading…</p>
          </div>
        </Centered>
      </AuthLoading>
      <Unauthenticated>
        <Centered>
          <AdminSignIn />
        </Centered>
      </Unauthenticated>
      <Authenticated>
        <AdminGate />
      </Authenticated>
    </ConvexAuthProvider>
  );
}

// The centered-card composition for the gate states (sign-in, loading, denied):
// brand row above a narrow card on paper.
function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="pn-center">
      <div className="pn-stack">
        <div className="pn-brand">
          <img src="/assets/wai-me-logo.png" alt="Women in Aviation Middle East" />
        </div>
        {children}
      </div>
    </div>
  );
}

// Signed in, but only the two super admins see the console. Everyone else gets
// a neutral "not available" state (the server refuses their queries regardless).
function AdminGate() {
  const isAdmin = useQuery(api.lib.adminAuth.amISuperAdmin);
  const { signOut } = useAuthActions();

  if (isAdmin === undefined) {
    return (
      <Centered>
        <div className={card}>
          <p className="pn-eyebrow on-paper">Admin console</p>
          <p className={muted}>Loading…</p>
        </div>
      </Centered>
    );
  }
  if (!isAdmin) {
    return (
      <Centered>
        <div className={card}>
          <p className="pn-eyebrow on-paper">Admin console</p>
          <h1 className={h1}>Not available</h1>
          <p className={muted}>
            This area is not available for your account. If you were looking for
            your membership, go to <a href="/portal">the member portal</a>.
          </p>
          <button type="button" className={linkBtn} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </Centered>
    );
  }
  return <AdminConsole onSignOut={() => void signOut()} />;
}

type QueueView = "conflicts" | "pipeline" | "guardians" | "dataRequests";
type SoonView = "members" | "partners" | "events" | "content";
type AdminView = "overview" | QueueView | "audit" | SoonView;

// The console is wider than the portal dashboard (dense queue rows + sidebar).
const consoleWidth = { "--pn-maxw": "1280px" } as CSSProperties;

const QUEUE_LABELS: Record<QueueView, string> = {
  conflicts: "Claim conflicts",
  pipeline: "Pipeline eligibility reviews",
  guardians: "Pending guardians",
  dataRequests: "Data requests",
};

// The honest Soon seams (spec scope decision 3): plain, factual copy about what
// exists today - never UI implying unbuilt capability.
const SOON_SEAMS: Record<SoonView, { name: string; copy: string }> = {
  members: {
    name: "Members",
    copy: "Member records live in the database and are managed through the review queues for now. A browsable member list is a later slice.",
  },
  partners: {
    name: "Partners",
    copy: "Corporate partnering today: a company reads the public partner page and emails support@waiorg.me, and Mervat takes it from there. Partner records in the console are a later slice.",
  },
  events: {
    name: "Events",
    copy: "Event management arrives with the events slice.",
  },
  content: {
    name: "Content",
    copy: "Site content is file-based and published through the build workflow. A content editor here is a later slice.",
  },
};

function AdminConsole({ onSignOut }: { onSignOut: () => void }) {
  const [view, setView] = useState<AdminView>("overview");
  const counts = useQuery(api.admin.overview.getAdminOverview);

  const queueCount = (queue: QueueView): number | undefined => {
    if (counts === undefined) {
      return undefined;
    }
    switch (queue) {
      case "conflicts":
        return counts.queue_conflicts;
      case "pipeline":
        return counts.queue_pipeline;
      case "guardians":
        return counts.queue_guardians;
      case "dataRequests":
        return counts.queue_data_requests;
    }
  };

  return (
    <>
      <div className="pn-hero">
        <div className="pn-hero-inner" style={consoleWidth}>
          <div className="pn-bar">
            <img
              src="/assets/wai-me-logo-on-dark.png"
              alt="Women in Aviation Middle East"
            />
            <button type="button" className={linkBtn} onClick={onSignOut}>
              Sign out
            </button>
          </div>
          <p className="pn-eyebrow">Admin console</p>
          <h1 className="pn-h1">Admin console</h1>
          <p>
            The safe-actions fallback. Every change here asks you to confirm, and
            is recorded below.
          </p>
        </div>
      </div>
      <div className="pn-main">
        <div className="pn-main-inner" style={consoleWidth}>
          <div className="pn-shell">
            <div className="pn-side">
              <nav aria-label="Admin sections">
                <div className="nav-grp">
                  <p className="grp">Today</p>
                  <NavItem active={view === "overview"} onSelect={() => setView("overview")}>
                    Overview
                  </NavItem>
                </div>
                <div className="nav-grp">
                  <p className="grp">Review queues</p>
                  {(Object.keys(QUEUE_LABELS) as QueueView[]).map((queue) => (
                    <NavItem
                      key={queue}
                      active={view === queue}
                      onSelect={() => setView(queue)}
                      count={queueCount(queue)}
                    >
                      {QUEUE_LABELS[queue]}
                    </NavItem>
                  ))}
                </div>
                <div className="nav-grp">
                  <p className="grp">Activity</p>
                  <NavItem active={view === "audit"} onSelect={() => setView("audit")}>
                    Recent panel actions
                  </NavItem>
                </div>
                <div className="nav-grp">
                  <p className="grp">Coming soon</p>
                  {(Object.keys(SOON_SEAMS) as SoonView[]).map((seam) => (
                    <NavItem
                      key={seam}
                      soon
                      active={view === seam}
                      onSelect={() => setView(seam)}
                    >
                      {SOON_SEAMS[seam].name}
                    </NavItem>
                  ))}
                </div>
              </nav>
            </div>
            <div className="pn-stack">
              {view === "overview" && (
                <AdminOverview counts={counts} onOpen={setView} />
              )}
              {view === "conflicts" && <ClaimConflictsQueue />}
              {view === "pipeline" && <PipelineReviewsQueue />}
              {view === "guardians" && <PendingGuardiansQueue />}
              {view === "dataRequests" && <DataRequestsQueue />}
              {view === "audit" && <AdminAuditLog />}
              {(view === "members" ||
                view === "partners" ||
                view === "events" ||
                view === "content") && (
                <div className="pn-slot">
                  <span className="pn-soon">Soon</span>
                  <p className="pn-name">{SOON_SEAMS[view].name}</p>
                  <p className={rowMeta}>{SOON_SEAMS[view].copy}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function NavItem({
  active,
  onSelect,
  count,
  soon,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  // Live queue count from the overview query; absent while it loads.
  count?: number;
  soon?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={soon ? "pn-nav-item is-soon" : "pn-nav-item"}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <span>{children}</span>
      {soon ? (
        <span className="n">Soon</span>
      ) : (
        count !== undefined && (
          <span className={count > 0 ? "n live" : "n"}>{count}</span>
        )
      )}
    </button>
  );
}

// The Overview view (spec criterion 9): plain-worded PII-free counts, the
// queues ordered by what is waiting, and a peek at the latest panel actions.
function AdminOverview({
  counts,
  onOpen,
}: {
  counts: AdminOverviewCounts | undefined;
  onOpen: (view: AdminView) => void;
}) {
  return (
    <>
      {counts === undefined ? (
        <p className="pn-meta">Loading…</p>
      ) : (
        <div className="pn-stats">
          <div className="pn-stat">
            <p className="k">Active members</p>
            <p className="v">{counts.members_active}</p>
            <p className="s">signed up or claimed, email confirmed</p>
          </div>
          <div className="pn-stat">
            <p className="k">Waiting on a step</p>
            <p className="v">{counts.members_waiting}</p>
            <p className="s">guardian, review or email confirmation</p>
          </div>
          <div className="pn-stat">
            <p className="k">Legacy records</p>
            <p className="v">{counts.legacy_registered}</p>
            <p className="s">imported list, registered - not yet active</p>
          </div>
          <div className="pn-stat">
            <p className="k">Claimed so far</p>
            <p className="v">{counts.legacy_claimed}</p>
            <p className="s">legacy members who moved across</p>
          </div>
        </div>
      )}
      <section className={queueSection}>
        <h2 className={queueTitle}>Today's queue</h2>
        {counts === undefined ? (
          <p className="pn-meta">Loading…</p>
        ) : (
          orderedQueues(counts).map(({ queue, count }) => (
            <button
              key={queue}
              type="button"
              className="pn-nav-item"
              onClick={() => onOpen(queue)}
            >
              <span>{QUEUE_LABELS[queue]}</span>
              <span className={count > 0 ? "n live" : "n"}>{count} waiting</span>
            </button>
          ))
        )}
      </section>
      <LatestActions onSeeAll={() => onOpen("audit")} />
    </>
  );
}

// Busiest queue first; ties keep the fixed queue order (sort is stable).
function orderedQueues(
  counts: AdminOverviewCounts,
): Array<{ queue: QueueView; count: number }> {
  return [
    { queue: "conflicts" as const, count: counts.queue_conflicts },
    { queue: "pipeline" as const, count: counts.queue_pipeline },
    { queue: "guardians" as const, count: counts.queue_guardians },
    { queue: "dataRequests" as const, count: counts.queue_data_requests },
  ].sort((a, b) => b.count - a.count);
}

// The first page of the existing audit query, as an overview peek. Read-only,
// PII-free summaries (server contract); "See all" jumps to the Activity view.
function LatestActions({ onSeeAll }: { onSeeAll: () => void }) {
  const page = useQuery(api.admin.audit.listAdminAuditLog, {});
  return (
    <section className={queueSection}>
      <h2 className={queueTitle}>Latest panel actions</h2>
      {page === undefined ? (
        <p className="pn-meta">Loading…</p>
      ) : page.rows.length === 0 ? (
        <p className="pn-meta">Nothing recorded yet.</p>
      ) : (
        <div className="pn-log">
          {page.rows.map((row) => (
            <div key={row.id} className="pn-log-row">
              <span className="pn-when">
                {new Date(row.timestamp).toLocaleString()}
              </span>
              <p className={rowMeta}>
                <strong>{row.action}</strong> by {row.actor}
              </p>
              {row.after_summary && <p className={rowMeta}>{row.after_summary}</p>}
            </div>
          ))}
        </div>
      )}
      <button type="button" className={linkBtn} onClick={onSeeAll}>
        See all
      </button>
    </section>
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
      <div className={card}>
        <p className="pn-eyebrow on-paper">Admin console</p>
        <h1 className={h1}>Check your email</h1>
        <p className={muted}>
          We sent a sign-in link to <strong>{sentTo}</strong>. It expires in 15
          minutes and can be used once.
        </p>
        <button type="button" className={linkBtn} onClick={() => setSentTo(null)}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className={card}>
      <p className="pn-eyebrow on-paper">Admin console</p>
      <h1 className={h1}>Admin sign-in</h1>
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
          className={input}
        />
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy ? "Sending…" : "Send sign-in link"}
        </button>
        {error !== null && <p className={errorText}>{error}</p>}
      </form>
    </div>
  );
}
