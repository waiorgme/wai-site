import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  DateBlock,
  EmptyState,
  NotificationRow,
  PanelCard,
  ProgressBar,
} from "../../panel/kit";
import { muted } from "../ui";
import {
  gulfDate,
  gulfMonthDay,
  gulfTime,
  standingHolderLine,
  standingWord,
  whenLabel,
} from "../format";
import type { PortalGo } from "../PortalShell";
import {
  CertificateSection,
  type CertsView,
  type MemberView,
  type MembershipCertView,
} from "./CertificateSection";
import type { MembershipView } from "./data";

// The adult Home: round 1's hero warmth inside the workspace main column,
// then the live pulse of her membership - completeness, events, opportunities,
// certificate, standing, notifications.

export function HomeView({
  me,
  certs,
  membershipCert,
  membership,
  go,
}: {
  me: NonNullable<MemberView>;
  certs: CertsView;
  membershipCert: MembershipCertView;
  membership: MembershipView;
  go: PortalGo;
}) {
  const firstName = me.name.split(" ")[0];
  // Year of issue, read from the certificate's own date label ("12 June 2026").
  // Labelled "Certificate issued", never "member since": a claimed legacy
  // member's certificate is issued at claim time, not when she first joined.
  const issuedYear =
    membershipCert?.issued_date_label.match(/\b\d{4}\b/)?.[0] ?? null;

  return (
    <>
      <section className="pn-hero-card">
        <p className="pn-eyebrow">Member portal</p>
        <h1 className="pn-h1">
          {`Welcome to WAI-ME${firstName ? `, ${firstName}` : ""}`}
        </h1>
        <p className={muted}>
          You're a member. Here's your certificate to start, your first of many
          wins as part of the community.
        </p>
        <div className="pn-glass">
          <div className="cell">
            <span className="label">Name</span>
            <span className="value">{me.name}</span>
          </div>
          <div className="cell">
            <span className="label">Standing</span>
            <span className="value">
              {membership == null ? "Member" : standingWord(membership.standing)}
            </span>
          </div>
          {membershipCert !== null && (
            <div className="cell">
              <span className="label">Membership number</span>
              <span className="value">WAIME-{membershipCert.membership_number}</span>
            </div>
          )}
          {issuedYear !== null && (
            <div className="cell">
              <span className="label">Certificate issued</span>
              <span className="value">{issuedYear}</span>
            </div>
          )}
        </div>
      </section>

      <CompletenessCard
        restricted={me.member_lane === "restricted_unknown"}
        go={go}
      />

      <div className="pn-grid">
        <UpcomingEventsCard go={go} />
        <OpportunitiesTeaser
          restricted={me.member_lane === "restricted_unknown"}
          go={go}
        />
      </div>

      <CertificateSection
        me={me}
        certs={certs}
        isActive
        membershipCert={membershipCert}
      />

      <div className="pn-grid">
        <StandingCard
          membership={membership}
          restricted={me.member_lane === "restricted_unknown"}
          go={go}
        />
        <NotificationsPreview go={go} />
      </div>
    </>
  );
}

// The five canonical "profile complete" fields (convex/lib/profile.ts), each
// with the honest plain-words reason it matters. The restricted_unknown lane
// keeps opportunities and the directory locked until her date of birth is
// confirmed, so its copy must not promise either.
function CompletenessCard({
  restricted,
  go,
}: {
  restricted: boolean;
  go: PortalGo;
}) {
  const profile = useQuery(api.members.getMyProfile);
  if (profile === undefined) {
    return (
      <PanelCard title="Your profile">
        <p className="pn-meta">Loading…</p>
      </PanelCard>
    );
  }
  if (profile === null) {
    return null;
  }
  const steps = [
    {
      key: "name",
      label: "Your name",
      unlocks: "on your certificate and your event passes",
      done: profile.name.trim() !== "",
    },
    {
      key: "photo",
      label: "A profile photo",
      unlocks: restricted
        ? "puts a face to your name on your profile"
        : "shows on your directory card, if you choose to be listed",
      done: profile.photo_url !== null,
    },
    {
      key: "stage",
      label: "Your career stage",
      unlocks: restricted
        ? "tells us where you are in your aviation journey"
        : "helps match the right opportunities to you",
      done: profile.career_stage_answer !== "",
    },
    {
      key: "field",
      label: "Your field",
      unlocks: restricted
        ? "tells us what you do in aviation"
        : "partners see this when you apply",
      done: profile.function_area !== "",
    },
    {
      key: "country",
      label: "Your country",
      unlocks: restricted
        ? "tells us where in the region you are"
        : "shows on your applications and directory card",
      done: profile.country_of_residence !== "",
    },
  ];
  const done = steps.filter((s) => s.done).length;
  const complete = done === steps.length;
  return (
    <PanelCard
      title="Your profile"
      count={`· ${done} of ${steps.length}`}
      actions={
        <button
          type="button"
          className="pn-btn pn-btn--ghost pn-btn--sm"
          onClick={() => go({ v: "profile" })}
        >
          {complete ? "Edit profile" : "Complete your profile"}
        </button>
      }
    >
      <ProgressBar
        label="Profile basics"
        value={(done / steps.length) * 100}
        valueLabel={`${done} of ${steps.length}`}
      />
      {complete ? (
        <p className="pn-meta">
          {restricted
            ? "Your profile is complete - it counts toward Active Member standing. Keep it fresh as you grow."
            : "Your profile is complete - you can apply for opportunities, and it counts toward Active Member standing. Keep it fresh as you grow."}
        </p>
      ) : (
        <>
          <p className="pn-meta">
            {restricted
              ? "These five basics are half of becoming an Active Member. The other half is taking part once."
              : "These five basics let you apply for opportunities, and they're half of becoming an Active Member. The other half is taking part once."}
          </p>
          <ul className="pn-steps">
            {steps.map((step) => (
              <li key={step.key}>
                {step.done ? (
                  <span className="ok-mark" aria-hidden="true">
                    ✓
                  </span>
                ) : (
                  <span className="todo-mark" aria-hidden="true" />
                )}
                <span>
                  <strong className={step.done ? "done" : undefined}>
                    {step.label}
                  </strong>
                  {" - "}
                  {step.unlocks}.
                  {step.done ? <span className="sr-only"> Done.</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </PanelCard>
  );
}

function UpcomingEventsCard({ go }: { go: PortalGo }) {
  const rows = useQuery(api.events.listEvents);
  const upcoming = (rows ?? []).filter((r) => !r.is_past).slice(0, 3);
  return (
    <PanelCard
      title="Upcoming events"
      tight
      actions={
        <button
          type="button"
          className="pn-link"
          onClick={() => go({ v: "events" })}
        >
          All events
        </button>
      }
    >
      {rows === undefined ? (
        <p className="pn-meta pn-loading">Loading…</p>
      ) : upcoming.length === 0 ? (
        <div className="pn-table-empty">
          <EmptyState
            eyebrow="Events"
            message="Nothing scheduled right now - new sessions appear here as soon as they are published."
          />
        </div>
      ) : (
        upcoming.map((event) => {
          const { month, day } = gulfMonthDay(event.starts_at);
          return (
            <div className="pn-event" key={event.eventId}>
              <DateBlock month={month} day={day} />
              <div className="body">
                <div className="head">
                  <p className="pn-name">{event.title}</p>
                  {event.my_state === "registered" ? (
                    <span className="pn-tag pn-tag--ok">Registered</span>
                  ) : event.my_state === "waitlisted" ? (
                    <span className="pn-tag pn-tag--info">On the waitlist</span>
                  ) : null}
                </div>
                <p className="pn-meta">
                  {gulfDate(event.starts_at)} · {gulfTime(event.starts_at)}{" "}
                  {event.timezone} ·{" "}
                  {event.format === "online"
                    ? "Online"
                    : [event.venue, event.city].filter(Boolean).join(", ") ||
                      "In person"}
                </p>
              </div>
              <div className="end">
                <button
                  type="button"
                  className="pn-btn pn-btn--ghost pn-btn--sm"
                  onClick={() => go({ v: "events", id: event.eventId })}
                >
                  View
                </button>
              </div>
            </div>
          );
        })
      )}
    </PanelCard>
  );
}

function OpportunitiesTeaser({
  restricted,
  go,
}: {
  // restricted_unknown lanes get an empty board from the server; the teaser
  // words that lock honestly instead of a misleading "nothing open".
  restricted: boolean;
  go: PortalGo;
}) {
  const rows = useQuery(
    api.opportunities.listOpportunities,
    restricted ? "skip" : {},
  );
  if (restricted) {
    return (
      <PanelCard title="Opportunities">
        <p className="pn-meta">
          Opportunities open once we confirm your date of birth. Write to
          support@waiorg.me and we will sort it out together.
        </p>
      </PanelCard>
    );
  }
  return (
    <PanelCard
      title="Opportunities"
      count={rows === undefined ? undefined : `· ${rows.length} open`}
      actions={
        <button
          type="button"
          className="pn-link"
          onClick={() => go({ v: "opportunities" })}
        >
          See the board
        </button>
      }
    >
      {rows === undefined ? (
        <p className="pn-meta">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="pn-meta">
          Nothing open right now. When a partner opportunity opens, it appears
          here first.
        </p>
      ) : (
        <p className="pn-meta">
          {rows.length === 1
            ? "1 opportunity is open to you right now"
            : `${rows.length} opportunities are open to you right now`}
          {" - scholarships, placements and member benefits from partners we work with."}
        </p>
      )}
    </PanelCard>
  );
}

function StandingCard({
  membership,
  restricted,
  go,
}: {
  membership: MembershipView;
  // restricted_unknown lane: the directory never opens until her date of
  // birth is confirmed, so the next-step line must not promise it
  // (MyMembershipView and the standing notification already word it this way).
  restricted: boolean;
  go: PortalGo;
}) {
  return (
    <PanelCard
      title="Your standing"
      actions={
        <button
          type="button"
          className="pn-link"
          onClick={() => go({ v: "membership" })}
        >
          See the ladder
        </button>
      }
    >
      {membership === undefined ? (
        <p className="pn-meta">Loading…</p>
      ) : membership === null ? (
        <p className="pn-meta">
          Your standing appears here once your membership is linked.
        </p>
      ) : (
        <>
          <p className="pn-meta">
            {membership.standing === "leadership_circle" ? (
              <>
                You're in the <strong>Leadership Circle</strong>.
              </>
            ) : (
              <>
                You're{" "}
                {membership.standing === "active_member" ||
                membership.standing === "ambassador"
                  ? "an"
                  : "a"}{" "}
                <strong>{standingWord(membership.standing)}</strong>.
              </>
            )}{" "}
            {standingHolderLine(membership.standing)}
          </p>
          {membership.standing === "member" ? (
            <p className="pn-meta">
              {membership.qualifying_progress.profile_complete
                ? restricted
                  ? "Next step: take part once - attend an event - and you become an Active Member automatically. That unlocks early event seats."
                  : "Next step: take part once - attend an event or apply for an opportunity - and you become an Active Member automatically. That unlocks the member directory and early event seats."
                : restricted
                  ? "Next step: finish your profile basics, then take part once - attend an event - and you become an Active Member automatically."
                  : "Next step: finish your profile basics, then take part once - attend an event or apply for an opportunity - and you become an Active Member automatically."}
            </p>
          ) : null}
        </>
      )}
    </PanelCard>
  );
}

function NotificationsPreview({ go }: { go: PortalGo }) {
  const rows = useQuery(api.notifications.myNotifications, { page: 0 });
  const latest = (rows ?? []).slice(0, 3);
  return (
    <PanelCard
      title="Latest"
      tight
      actions={
        <button
          type="button"
          className="pn-link"
          onClick={() => go({ v: "notifications" })}
        >
          See all
        </button>
      }
    >
      {rows === undefined ? (
        <p className="pn-meta pn-loading">Loading…</p>
      ) : latest.length === 0 ? (
        <div className="pn-table-empty">
          <EmptyState
            eyebrow="Notifications"
            message="Nothing yet. Your seats, applications and certificates all land here."
          />
        </div>
      ) : (
        latest.map((row) => (
          <NotificationRow
            key={row.id}
            title={row.title}
            body={row.body}
            when={whenLabel(row.created_at)}
            unread={row.read_at === null}
            onOpen={() => go({ v: "notifications" })}
          />
        ))
      )}
    </PanelCard>
  );
}
