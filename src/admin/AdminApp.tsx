import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { convex } from "../portal/convex";
import { sendLinkErrorMessage } from "../portal/errors";
import { ErrorBoundary } from "../portal/ErrorBoundary";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { card, errorText, h1, input, linkBtn, muted, primaryBtn } from "../portal/ui";
import { AppShell, PageHeader, SideNav } from "../panel/kit";
import type { NavGroup } from "../panel/kit";
import {
  IconAlertTriangle,
  IconAward,
  IconBarChart,
  IconBriefcase,
  IconBuilding,
  IconCalendar,
  IconDashboard,
  IconInbox,
  IconScrollText,
  IconShieldCheck,
  IconUserCheck,
  IconUsers,
} from "../panel/icons";
import { ClaimConflictsQueue } from "./ClaimConflictsQueue";
import { PipelineReviewsQueue } from "./PipelineReviewsQueue";
import { PendingGuardiansQueue } from "./PendingGuardiansQueue";
import { DataRequestsQueue } from "./DataRequestsQueue";
import { AdminAuditLog } from "./AdminAuditLog";
import type { AdminViewName, Go } from "./views/shared";
import { initials } from "./views/shared";
import { OverviewV2 } from "./views/OverviewV2";
import { MembersView } from "./views/MembersView";
import { MemberDetail } from "./views/MemberDetail";
import { CertificatesView } from "./views/CertificatesView";
import { EventsView } from "./views/EventsView";
import { EventEditor } from "./views/EventEditor";
import { EventRegistrationsView } from "./views/EventRegistrationsView";
import { OpportunitiesView } from "./views/OpportunitiesView";
import { OpportunityEditor } from "./views/OpportunityEditor";
import { PartnersView } from "./views/PartnersView";
import { PartnerDetail } from "./views/PartnerDetail";
import { ReportsView } from "./views/ReportsView";

// The /admin fallback UI (admin-panel spec). A distinct surface from /portal so
// a member-facing bug can never leak admin controls to an ordinary session. The
// server check (requireSuperAdmin) is what actually protects the data; the UI
// hiding below is a courtesy (criterion 1, deny-by-default).
//
// panel-experience slice: the signed-in console is the full workspace shell
// (AppShell + SideNav over local view state) - overview, members, certificates,
// events, opportunities, partners, the four review queues by their exact
// names, reports and the audit log. Every write anywhere in it is
// propose-then-confirm and audited. The auth gates, sign-in and denied cards
// below are unchanged from round 1.

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
        <ErrorBoundary
          fallback={
            <Centered>
              <div className={card}>
                <p className="pn-eyebrow on-paper">Admin console</p>
                <h1 className={h1}>Something went wrong</h1>
                <p className={muted}>
                  Something went wrong on our side. Reload the page to continue.
                </p>
                <button
                  type="button"
                  className={linkBtn}
                  onClick={() => window.location.reload()}
                >
                  Reload the page
                </button>
              </div>
            </Centered>
          }
        >
          <AdminGate />
        </ErrorBoundary>
      </Authenticated>
    </ConvexAuthProvider>
  );
}

// The centered-card composition for the gate states (sign-in, loading, denied):
// brand row above a narrow card on paper.
function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="pn-center">
      <div className="pn-brand">
        <img src="/assets/wai-me-logo.png" alt="Women in Aviation Middle East" />
      </div>
      {children}
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

const QUEUE_LABELS: Record<QueueView, string> = {
  conflicts: "Claim conflicts",
  pipeline: "Pipeline eligibility reviews",
  guardians: "Pending guardians",
  dataRequests: "Data requests",
};

type AdminViewState = { v: AdminViewName; id?: string };

// The console mirrors the portal shell's history mechanic: every view (and
// detail/editor, via the id in the hash) is a real history entry, so browser
// Back walks the console and a refresh keeps your place.
const VIEW_TO_HASH: Readonly<Record<AdminViewName, string>> = {
  overview: "",
  members: "#members",
  member: "#member",
  certificates: "#certificates",
  events: "#events",
  eventEditor: "#event-editor",
  eventRegs: "#event-registrations",
  opportunities: "#opportunities",
  opportunityEditor: "#opportunity-editor",
  partners: "#partners",
  partnerEditor: "#partner-editor",
  reports: "#reports",
  conflicts: "#claim-conflicts",
  pipeline: "#pipeline-reviews",
  guardians: "#pending-guardians",
  dataRequests: "#data-requests",
  audit: "#audit",
};

const HASH_TO_VIEW: Readonly<Record<string, AdminViewName>> = {
  "#members": "members",
  "#member": "member",
  "#certificates": "certificates",
  "#events": "events",
  "#event-editor": "eventEditor",
  "#event-registrations": "eventRegs",
  "#opportunities": "opportunities",
  "#opportunity-editor": "opportunityEditor",
  "#partners": "partners",
  "#partner-editor": "partnerEditor",
  "#reports": "reports",
  "#claim-conflicts": "conflicts",
  "#pipeline-reviews": "pipeline",
  "#pending-guardians": "guardians",
  "#data-requests": "dataRequests",
  "#audit": "audit",
};

const ID_VIEWS: ReadonlyArray<AdminViewName> = [
  "member",
  "eventEditor",
  "eventRegs",
  "opportunityEditor",
  "partnerEditor",
];

// A detail hash with its id missing falls back to the list it belongs to.
const ID_REQUIRED: Partial<Record<AdminViewName, AdminViewName>> = {
  member: "members",
  eventRegs: "events",
};

const hashForView = (view: AdminViewState): string => {
  const base = VIEW_TO_HASH[view.v];
  return view.id !== undefined && ID_VIEWS.includes(view.v)
    ? `${base}/${encodeURIComponent(view.id)}`
    : base;
};

const viewFromLocation = (): AdminViewState => {
  if (typeof window === "undefined") {
    return { v: "overview" };
  }
  const hash = window.location.hash;
  const slash = hash.indexOf("/");
  const base = slash === -1 ? hash : hash.slice(0, slash);
  const v = HASH_TO_VIEW[base] ?? "overview";
  const id = slash === -1 ? "" : decodeURIComponent(hash.slice(slash + 1));
  if (id !== "" && ID_VIEWS.includes(v)) {
    return { v, id };
  }
  return { v: ID_REQUIRED[v] ?? v };
};

// The four round-1 queues and the audit log keep their own internals but open
// with the same page anatomy as every other console view.
function QueuePage({
  eyebrow = "Review queues",
  title,
  sub,
  children,
}: {
  eyebrow?: string;
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} sub={sub} />
      {children}
    </>
  );
}

function AdminConsole({ onSignOut }: { onSignOut: () => void }) {
  const [view, setView] = useState<AdminViewState>(() => viewFromLocation());
  const counts = useQuery(api.admin.overview.getAdminOverview);
  // The admin is herself a member (the allowlist resolves through the members
  // table), so the identity block can carry her real email.
  const me = useQuery(api.members.getCurrentMember);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);

  const go: Go = (v, id) => {
    const target: AdminViewState = id === undefined ? { v } : { v, id };
    setView(target);
    const hash = hashForView(target);
    const url = hash === "" ? window.location.pathname : hash;
    if (window.location.hash !== hash) {
      history.pushState(null, "", url);
    }
  };

  // Manual hash edits and the browser Back/Forward buttons land on the right
  // view (pushState itself never fires hashchange).
  useEffect(() => {
    const onHash = () => setView(viewFromLocation());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // View switches move focus to the fresh pane (SPA focus discipline) and
  // return the scroll to the top. Skipped on first mount.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    window.scrollTo(0, 0);
    paneRef.current?.focus();
  }, [view.v, view.id]);

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

  // A nav entry stays lit for its detail/editor sub-views.
  const activeFor: Partial<Record<AdminViewName, ReadonlyArray<AdminViewName>>> = {
    members: ["members", "member"],
    events: ["events", "eventEditor", "eventRegs"],
    opportunities: ["opportunities", "opportunityEditor"],
    partners: ["partners", "partnerEditor"],
  };
  const item = (key: AdminViewName, label: string, icon: ReactElement) => ({
    key,
    label,
    icon,
    active: (activeFor[key] ?? [key]).includes(view.v),
    onSelect: () => go(key),
  });

  const queueIcons: Record<QueueView, ReactElement> = {
    conflicts: <IconAlertTriangle />,
    pipeline: <IconUserCheck />,
    guardians: <IconShieldCheck />,
    dataRequests: <IconInbox />,
  };

  const groups: NavGroup[] = [
    { label: "Today", items: [item("overview", "Overview", <IconDashboard />)] },
    {
      label: "Membership",
      items: [
        item("members", "Members", <IconUsers />),
        item("certificates", "Certificates", <IconAward />),
      ],
    },
    {
      label: "Programmes",
      items: [
        item("events", "Events", <IconCalendar />),
        item("opportunities", "Opportunities", <IconBriefcase />),
        item("partners", "Partners", <IconBuilding />),
      ],
    },
    {
      label: "Review queues",
      items: (Object.keys(QUEUE_LABELS) as QueueView[]).map((queue) => {
        const count = queueCount(queue);
        return {
          ...item(queue, QUEUE_LABELS[queue], queueIcons[queue]),
          count,
          live: count !== undefined && count > 0,
        };
      }),
    },
    {
      label: "System",
      items: [
        item("reports", "Reports", <IconBarChart />),
        item("audit", "Recent panel actions", <IconScrollText />),
      ],
    },
  ];

  const page = (() => {
    switch (view.v) {
      case "overview":
        return <OverviewV2 counts={counts} go={go} />;
      case "members":
        return <MembersView go={go} />;
      case "member":
        return (
          <MemberDetail key={view.id} memberId={view.id as Id<"members">} go={go} />
        );
      case "certificates":
        return <CertificatesView go={go} />;
      case "events":
        return <EventsView go={go} />;
      case "eventEditor":
        return (
          <EventEditor
            key={view.id ?? "new"}
            eventId={view.id as Id<"events"> | undefined}
            go={go}
          />
        );
      case "eventRegs":
        return (
          <EventRegistrationsView
            key={view.id}
            eventId={view.id as Id<"events">}
            go={go}
          />
        );
      case "opportunities":
        return <OpportunitiesView go={go} />;
      case "opportunityEditor":
        return (
          <OpportunityEditor
            key={view.id ?? "new"}
            id={view.id as Id<"opportunities"> | undefined}
            go={go}
          />
        );
      case "partners":
        return <PartnersView go={go} />;
      case "partnerEditor":
        return (
          <PartnerDetail
            key={view.id ?? "new"}
            partnerId={view.id as Id<"partners"> | undefined}
            go={go}
          />
        );
      case "reports":
        return <ReportsView />;
      case "conflicts":
        return (
          <QueuePage
            title="Claim conflicts"
            sub="Records that share an email or did not safely match at claim. Release or archive; every action asks you to confirm."
          >
            <ClaimConflictsQueue />
          </QueuePage>
        );
      case "pipeline":
        return (
          <QueuePage
            title="Pipeline eligibility reviews"
            sub="Members who opted in to be found by trusted partners. Approve or reject; nothing reaches a partner before your yes."
          >
            <PipelineReviewsQueue />
          </QueuePage>
        );
      case "guardians":
        return (
          <QueuePage
            title="Pending guardians"
            sub="Members under 18 waiting on a parent or guardian. You can resend the email; only the guardian's own button press confirms."
          >
            <PendingGuardiansQueue />
          </QueuePage>
        );
      case "dataRequests":
        return (
          <QueuePage
            title="Data requests"
            sub="Requests to see or delete personal data. Approving records the decision; fulfilment stays a separate, deliberate step."
          >
            <DataRequestsQueue />
          </QueuePage>
        );
      case "audit":
        return (
          <QueuePage
            eyebrow="System"
            title="Recent panel actions"
            sub="Every change made through this console, newest first. Read-only."
          >
            <AdminAuditLog />
          </QueuePage>
        );
    }
  })();

  return (
    <AppShell
      brand={
        <>
          {/* Square icon, matching the portal shell: the wide wordmark
              crowded the 244px rail and cannot live in the collapsed rail. */}
          <img src="/assets/wai-me-icon.png" alt="" />
          <span className="lk">
            <span className="nm">WAI-ME</span>
            <span className="sub">Admin console</span>
          </span>
        </>
      }
      nav={<SideNav groups={groups} label="Admin sections" />}
      identity={
        <>
          <span className="pn-initials" title={me == null ? undefined : me.name}>
            {me == null || me.name.trim() === "" ? "SA" : initials(me.name)}
          </span>
          <span className="who">
            <span className="nm">{me == null ? "Super admin" : me.name}</span>
            {me == null ? null : <span className="em">{me.email}</span>}
          </span>
          <button type="button" className="pn-side-out" onClick={onSignOut}>
            Sign out
          </button>
        </>
      }
    >
      <div className="pn-view" ref={paneRef} tabIndex={-1}>
        {/* Keyed by view so navigating away clears a failed pane. */}
        <ErrorBoundary
          key={`${view.v}:${view.id ?? ""}`}
          fallback={
            <p className="pn-error">
              Something went wrong loading this view. Reload the page to try
              again.
            </p>
          }
        >
          {page}
        </ErrorBoundary>
      </div>
    </AppShell>
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
          aria-label="Email address"
          placeholder="you@example.com"
          className={input}
        />
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy ? "Sending…" : "Send sign-in link"}
        </button>
        {error !== null && <p role="alert" className={errorText}>{error}</p>}
      </form>
    </div>
  );
}
