import { IconCheck } from "../../panel/icons";
import { PageHeader, PanelCard, StatTile } from "../../panel/kit";
import {
  gulfDate,
  memberSinceLabel,
  standingLine,
  standingWord,
  type Standing,
} from "../format";
import type { PortalGo, PortalLane } from "../PortalShell";
import type { MembershipView } from "./data";

// My membership (spec C10): the summary in plain words, the four-rung
// standing ladder with her position marked, and the honest next step driven
// by the SAME qualifying_progress the server's automatic promotion checks.
// Ambassador and Leadership Circle are shown honestly as by-invitation,
// later this year. The youth lane's locked-choices line lives here.

const RUNGS: ReadonlyArray<Standing> = [
  "member",
  "active_member",
  "ambassador",
  "leadership_circle",
];

export function MyMembershipView({
  lane,
  restricted,
  membership,
  go,
}: {
  lane: PortalLane;
  // Unknown-age accounts: the directory never opens for them, so the
  // next-step copy must not promise it.
  restricted: boolean;
  membership: MembershipView;
  go: PortalGo;
}) {
  const header = (
    <PageHeader
      eyebrow="Membership"
      title="My membership"
      sub="Where you stand, in plain words - and the honest next step."
    />
  );

  if (membership === undefined) {
    return (
      <>
        {header}
        <p className="pn-meta">Loading…</p>
      </>
    );
  }
  if (membership === null) {
    return (
      <>
        {header}
        <p className="pn-error">
          We couldn't load your membership. Refresh the page to try again, or
          email <a href="mailto:support@waiorg.me">support@waiorg.me</a>.
        </p>
      </>
    );
  }

  const progress = membership.qualifying_progress;
  const tookPart = progress.has_attended || progress.has_applied;

  return (
    <>
      {header}

      <div className="pn-stats">
        <StatTile
          label="Status"
          value={membership.lifecycle_state === "active" ? "Active" : "Paused"}
          sub={
            membership.lifecycle_state === "active"
              ? "Your membership is live."
              : "Something needs a look - email support@waiorg.me."
          }
        />
        <StatTile
          label="Member since"
          value={
            <span className="v--text">
              {memberSinceLabel(membership.member_since)}
            </span>
          }
          sub="Your original join date, kept through the move to this portal."
        />
        <StatTile
          label="Membership number"
          value={
            <span className="v--text">
              {membership.certificate !== null
                ? `WAIME-${membership.certificate.number}`
                : "On its way"}
            </span>
          }
          sub={
            membership.certificate === null
              ? "Issued with your certificate."
              : membership.certificate.status === "valid"
                ? "On your certificate and your event passes."
                : membership.certificate.status === "superseded"
                  ? "A corrected certificate replaced this one."
                  : "This certificate was revoked - email support@waiorg.me."
          }
        />
      </div>

      <p className="pn-meta">
        Your membership certificate lives on your{" "}
        <button type="button" className="pn-link" onClick={() => go({ v: "home" })}>
          Home page
        </button>
        , ready to view, verify and share.
      </p>

      {lane === "youth" && (
        <p className="pn-notice">
          Some choices - like being listed in the member directory and partner
          opportunities - open when you turn 18. Everything here is already
          yours.
        </p>
      )}

      <PanelCard title="The standing ladder">
        <p className="pn-meta">
          Standing is how the community recognises taking part. It only ever
          moves when something real happens, and every step is explained in
          plain words.
        </p>
        <ol className="pn-ladder">
          {RUNGS.map((rung, i) => (
            <li
              key={rung}
              className={
                membership.standing === rung ? "pn-rung is-here" : "pn-rung"
              }
            >
              <span className="step" aria-hidden="true">
                {i + 1}
              </span>
              <span className="body">
                <span className="head">
                  <strong>{standingWord(rung)}</strong>
                  {membership.standing === rung && (
                    <span className="pn-tag pn-tag--info">You are here</span>
                  )}
                </span>
                <span className="pn-meta">{standingLine(rung)}</span>
              </span>
            </li>
          ))}
        </ol>
      </PanelCard>

      {membership.standing === "member" ? (
        <PanelCard title="Your next step">
          <p className="pn-meta">
            Two things make you an Active Member. It happens automatically the
            moment both are true - no form, no waiting:
          </p>
          <ul className="pn-steps">
            <li>
              {progress.profile_complete ? (
                <span className="ok-mark" aria-hidden="true">
                  <IconCheck />
                </span>
              ) : (
                <span className="todo-mark" aria-hidden="true" />
              )}
              <span>
                <strong className={progress.profile_complete ? "done" : undefined}>
                  {lane === "youth"
                    ? "Your profile basics"
                    : "Finish your profile basics"}
                </strong>
                {lane === "youth" ? (
                  <>
                    {" - our team completes these with you. Email "}
                    <a href="mailto:support@waiorg.me">support@waiorg.me</a>.
                  </>
                ) : (
                  " - five quick fields."
                )}
                {progress.profile_complete ? (
                  <span className="sr-only"> Done.</span>
                ) : null}
              </span>
            </li>
            <li>
              {tookPart ? (
                <span className="ok-mark" aria-hidden="true">
                  <IconCheck />
                </span>
              ) : (
                <span className="todo-mark" aria-hidden="true" />
              )}
              <span>
                <strong className={tookPart ? "done" : undefined}>
                  Take part once
                </strong>
                {lane === "youth" ? (
                  " - attend an event."
                ) : restricted ? (
                  <>
                    {" - events and opportunities open once we confirm your"}
                    {" date of birth. Email "}
                    <a href="mailto:support@waiorg.me">support@waiorg.me</a>
                    {" and we will sort it out together."}
                  </>
                ) : (
                  " - attend an event, or apply for an opportunity."
                )}
                {tookPart ? <span className="sr-only"> Done.</span> : null}
              </span>
            </li>
          </ul>
          <div className="pn-actions">
            {lane === "full" && !progress.profile_complete && (
              <button
                type="button"
                className="pn-btn pn-btn--ghost pn-btn--sm"
                onClick={() => go({ v: "profile" })}
              >
                Finish my profile
              </button>
            )}
            <button
              type="button"
              className="pn-btn pn-btn--ghost pn-btn--sm"
              onClick={() => go({ v: "events" })}
            >
              See upcoming events
            </button>
          </div>
        </PanelCard>
      ) : (
        <PanelCard title="Your next step">
          <p className="pn-meta">
            {membership.standing === "active_member"
              ? restricted
                ? "You're an Active Member. Events, opportunities and the directory open once we confirm your date of birth - email support@waiorg.me and we will sort it out together. Ambassador comes by invitation, when the recognition programme opens."
                : "You're an Active Member - the member directory and early event seats are open to you. Ambassador comes by invitation, when the recognition programme opens, for members who lift the community."
              : "You're among the community's recognised voices. There's nothing to chase here - thank you for lifting others."}
          </p>
        </PanelCard>
      )}

      {membership.standing_history.length > 0 && (
        <PanelCard title="How you got here" tight>
          {membership.standing_history.map((entry, i) => (
            <div className="pn-notif pn-notif--plain" key={i}>
              <span className="row1">
                <span className="t">
                  {plainStanding(entry.from_standing)} to{" "}
                  {plainStanding(entry.to_standing)}
                </span>
                <span className="when">{gulfDate(entry.timestamp)}</span>
              </span>
              <span className="b">{plainReason(entry.reason)}</span>
            </div>
          ))}
        </PanelCard>
      )}

      <PanelCard title="Quick links">
        <div className="pn-actions">
          {lane === "full" && (
            <>
              <button
                type="button"
                className="pn-link"
                onClick={() => go({ v: "choices" })}
              >
                Your choices
              </button>
              <button
                type="button"
                className="pn-link"
                onClick={() => go({ v: "profile" })}
              >
                Your profile
              </button>
            </>
          )}
          <button
            type="button"
            className="pn-link"
            onClick={() => go({ v: "yourdata" })}
          >
            Your data
          </button>
          <button
            type="button"
            className="pn-link"
            onClick={() => go({ v: "help" })}
          >
            Help &amp; support
          </button>
        </div>
      </PanelCard>
    </>
  );
}

// The server writes promotion reasons as "profile complete + {action}"
// shorthand (convex/lib/standing.ts); member surfaces get the full sentence.
// Anything unexpected is shown as recorded (honest, never invented).
const PROMOTION_REASON_PREFIX = "profile complete + ";
const plainReason = (reason: string): string => {
  if (!reason.startsWith(PROMOTION_REASON_PREFIX)) return reason;
  const action = reason.slice(PROMOTION_REASON_PREFIX.length);
  return action.startsWith("completed your profile")
    ? `You ${action}.`
    : `You completed your profile and ${action}.`;
};

// standing_history rows arrive as plain strings; show known ones in plain
// words and anything unexpected as recorded (honest, never invented).
const plainStanding = (value: string): string => {
  switch (value) {
    case "member":
      return "Member";
    case "active_member":
      return "Active Member";
    case "ambassador":
      return "Ambassador";
    case "leadership_circle":
      return "Leadership Circle";
    default:
      return value;
  }
};
