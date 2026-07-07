import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AppShell, SideNav } from "../panel/kit";
import type { NavGroup } from "../panel/kit";
import {
  IconAward,
  IconCalendar,
  IconCalendarCheck,
  IconBriefcase,
  IconDatabase,
  IconHelp,
  IconHome,
  IconSliders,
  IconUser,
  IconUsers,
} from "../panel/icons";
import type {
  CertsView,
  MemberView,
  MembershipCertView,
} from "./views/CertificateSection";
import { initialsOf, standingWord } from "./format";
import { HomeView } from "./views/HomeView";
import { YouthHomeView } from "./views/YouthHomeView";
import { EventsView } from "./views/EventsView";
import { EventDetailView } from "./views/EventDetailView";
import { MyEventsView } from "./views/MyEventsView";
import { OpportunitiesView } from "./views/OpportunitiesView";
import { OpportunityDetailView } from "./views/OpportunityDetailView";
import { DirectoryView } from "./views/DirectoryView";
import { MyMembershipView } from "./views/MyMembershipView";
import { NotificationsView } from "./views/NotificationsView";
import { ProfileView } from "./views/ProfileView";
import { ChoicesView } from "./views/ChoicesView";
import { YourDataView } from "./views/YourDataView";
import { HelpView } from "./views/HelpView";

// The member portal workspace shell (panel-experience round 2). Renders ONLY
// for an ACTIVE member: Dashboard.tsx keeps the whole pre-active ladder and
// hands over here for the two active branches. The youth lane gets the
// reduced nav - no Opportunities, Directory, Profile editor or Your choices
// (the servers refuse those surfaces too; this UI simply mirrors them).

export type PortalLane = "full" | "youth";

export type PortalViewKey =
  | "home"
  | "events"
  | "myevents"
  | "opportunities"
  | "directory"
  | "membership"
  | "profile"
  | "choices"
  | "yourdata"
  | "help"
  | "notifications";

export type PortalViewState = {
  v: PortalViewKey;
  id?: string;
  // A one-line explanation shown by the target view (e.g. why an application
  // routed her to the profile editor).
  notice?: string;
};

// go() is how every view navigates; href-based notification links resolve
// through hrefToView below.
export type PortalGo = (next: PortalViewState) => void;

const YOUTH_BLOCKED: ReadonlyArray<PortalViewKey> = [
  "myevents",
  "opportunities",
  "directory",
  "profile",
  "choices",
];

const laneAllows = (lane: PortalLane, view: PortalViewKey): boolean =>
  lane === "full" || !YOUTH_BLOCKED.includes(view);

const HASH_TO_VIEW: Readonly<Record<string, PortalViewKey>> = {
  "#home": "home",
  "#events": "events",
  "#my-events": "myevents",
  "#opportunities": "opportunities",
  "#directory": "directory",
  "#membership": "membership",
  "#profile": "profile",
  "#choices": "choices",
  "#your-data": "yourdata",
  "#help": "help",
  "#notifications": "notifications",
};

const VIEW_TO_HASH: Readonly<Record<PortalViewKey, string>> = {
  home: "",
  events: "#events",
  myevents: "#my-events",
  opportunities: "#opportunities",
  directory: "#directory",
  membership: "#membership",
  profile: "#profile",
  choices: "#choices",
  yourdata: "#your-data",
  help: "#help",
  notifications: "#notifications",
};

// Notification hrefs are written server-side as "/portal", "/portal#events",
// "/portal#opportunities": resolve them to an in-shell view; anything else
// (a real page like /verify) is a plain navigation.
export const hrefToView = (href: string): PortalViewKey | null => {
  if (!href.startsWith("/portal")) {
    return null;
  }
  const hashStart = href.indexOf("#");
  if (hashStart === -1) {
    return "home";
  }
  return HASH_TO_VIEW[href.slice(hashStart)] ?? "home";
};

const viewFromLocation = (lane: PortalLane): PortalViewState => {
  if (typeof window === "undefined") {
    return { v: "home" };
  }
  const v = HASH_TO_VIEW[window.location.hash] ?? "home";
  return { v: laneAllows(lane, v) ? v : "home" };
};

export function PortalShell({
  lane,
  me,
  certs,
  membershipCert,
  onSignOut,
}: {
  lane: PortalLane;
  me: NonNullable<MemberView>;
  certs: CertsView;
  membershipCert: MembershipCertView;
  onSignOut: () => void;
}) {
  const [view, setView] = useState<PortalViewState>(() => viewFromLocation(lane));
  const unread = useQuery(api.notifications.unreadCount) ?? 0;
  const membership = useQuery(api.membership.getMyMembership);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);

  const go = useCallback<PortalGo>(
    (next) => {
      const v = laneAllows(lane, next.v) ? next.v : "home";
      setView({ ...next, v });
      if (typeof window !== "undefined") {
        const hash = VIEW_TO_HASH[v];
        const url = hash === "" ? window.location.pathname : hash;
        if (window.location.hash !== hash) {
          // A real history entry per view, so the browser Back button steps
          // back through the shell instead of leaving the portal.
          history.pushState(null, "", url);
        }
      }
    },
    [lane],
  );

  // Manual hash edits (or an external /portal#... link opened while the shell
  // is already mounted) still land on the right view.
  useEffect(() => {
    const onHash = () => setView(viewFromLocation(lane));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [lane]);

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

  const isMinorLane =
    me.member_lane === "minor" || me.member_lane === "restricted_unknown";
  const item = (key: PortalViewKey, label: string, icon: ReactElement) => ({
    key,
    label,
    icon,
    active: view.v === key,
    onSelect: () => go({ v: key }),
  });

  const groups: NavGroup[] =
    lane === "youth"
      ? [
          { items: [item("home", "Home", <IconHome />)] },
          { label: "Take part", items: [item("events", "Events", <IconCalendar />)] },
          {
            label: "Your membership",
            items: [
              item("membership", "My membership", <IconAward />),
              item("yourdata", "Your data", <IconDatabase />),
            ],
          },
          { items: [item("help", "Help & support", <IconHelp />)] },
        ]
      : [
          { items: [item("home", "Home", <IconHome />)] },
          {
            label: "Take part",
            items: [
              item("events", "Events", <IconCalendar />),
              item("myevents", "My events", <IconCalendarCheck />),
              item("opportunities", "Opportunities", <IconBriefcase />),
              item("directory", "Directory", <IconUsers />),
            ],
          },
          {
            label: "Your membership",
            items: [
              item("membership", "My membership", <IconAward />),
              item("profile", "Profile", <IconUser />),
              item("choices", "Your choices", <IconSliders />),
              item("yourdata", "Your data", <IconDatabase />),
            ],
          },
          { items: [item("help", "Help & support", <IconHelp />)] },
        ];

  const page = (() => {
    switch (view.v) {
      case "home":
        return lane === "youth" ? (
          <YouthHomeView me={me} certs={certs} membershipCert={membershipCert} standing={membership?.standing ?? "member"} />
        ) : (
          <HomeView
            me={me}
            certs={certs}
            membershipCert={membershipCert}
            membership={membership}
            go={go}
          />
        );
      case "events":
        return view.id !== undefined ? (
          <EventDetailView
            eventId={view.id as Id<"events">}
            membership={membership}
            go={go}
          />
        ) : (
          <EventsView lane={lane} restricted={isMinorLane} go={go} />
        );
      case "myevents":
        return <MyEventsView go={go} />;
      case "opportunities":
        return view.id !== undefined ? (
          <OpportunityDetailView id={view.id as Id<"opportunities">} go={go} />
        ) : (
          // The full lane still carries restricted_unknown accounts: the
          // server already returns them an empty board, and the view words
          // the lock honestly instead of showing a dishonest "nothing open".
          <OpportunitiesView restricted={isMinorLane} go={go} />
        );
      case "directory":
        return <DirectoryView />;
      case "membership":
        return <MyMembershipView lane={lane} restricted={isMinorLane} membership={membership} go={go} />;
      case "profile":
        return (
          <ProfileView
            hideMentorship={isMinorLane}
            notice={view.notice}
            onDone={() => go({ v: "home" })}
          />
        );
      case "choices":
        return <ChoicesView onDone={() => go({ v: "home" })} />;
      case "yourdata":
        return <YourDataView />;
      case "help":
        return <HelpView />;
      case "notifications":
        return <NotificationsView go={go} />;
    }
  })();

  return (
    <AppShell
      brand={
        <>
          {/* The square icon, not the wide wordmark: the 875x200 lockup left
              no room for the bell in a 244px rail (Issam, 2026-07-07), and
              the icon doubles as the collapsed-rail mark. */}
          <img src="/assets/wai-me-icon.png" alt="" />
          <span className="lk">
            <span className="nm">WAI-ME</span>
            <span className="sub">Member portal</span>
          </span>
          <button
            type="button"
            className="pn-bell"
            aria-label={
              unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
            }
            onClick={() => go({ v: "notifications" })}
          >
            <BellGlyph />
            {unread > 0 ? <span className="n">{unread > 99 ? "99+" : unread}</span> : null}
          </button>
        </>
      }
      nav={<SideNav groups={groups} label="Portal sections" />}
      identity={
        <>
          <span className="pn-initials">{initialsOf(me.name)}</span>
          <span className="who">
            <span className="nm">{me.name}</span>
            {/* Standing plain word; its one-line explanation lives on Home and
                My membership (a chrome chip has no room to explain). */}
            <span className="em">
              {membership == null ? "Member" : standingWord(membership.standing)}
            </span>
          </span>
          <button type="button" className="pn-side-out" onClick={onSignOut}>
            Sign out
          </button>
        </>
      }
    >
      <div className="pn-view" ref={paneRef} tabIndex={-1}>
        {page}
      </div>
    </AppShell>
  );
}

function BellGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
