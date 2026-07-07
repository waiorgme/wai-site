import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { EmptyState, PageHeader, PanelCard } from "../../panel/kit";
import {
  applicationStateWord,
  excerpt,
  gulfDate,
  gulfDeadlineLabel,
  opportunityTypeWord,
  type ApplicationState,
} from "../format";
import type { PortalGo, PortalLane } from "../PortalShell";

// The opportunities board (spec B6): open listings she is eligible for, typed
// in plain words, deadlines in the "11:59 PM GST" convention, plus her own
// applications with honest state words. The server decides eligibility; a
// restricted (unknown-age) lane and the youth lane get the honest locked
// line instead of a dishonest "nothing open" - but her own application
// HISTORY stays hers whatever her lane becomes (dated ruling, Gate 4
// round 7): results and notes render read-only, never linking into the
// gated board.

type BoardRows = ReturnType<typeof useQuery<typeof api.opportunities.listOpportunities>>;
type MyApplications = ReturnType<typeof useQuery<typeof api.opportunities.myApplications>>;
type MyApplicationRow = NonNullable<MyApplications>[number];

export function OpportunitiesView({
  lane,
  restricted,
  go,
}: {
  lane: PortalLane;
  restricted: boolean;
  go: PortalGo;
}) {
  const locked = restricted || lane === "youth";
  const rows: BoardRows = useQuery(
    api.opportunities.listOpportunities,
    locked ? "skip" : {},
  );
  // Always queried: own history is own data (the server returns her rows
  // whatever her lane).
  const mine: MyApplications = useQuery(api.opportunities.myApplications, {});

  const header = (
    <PageHeader
      eyebrow="Opportunities"
      title={locked ? "My applications" : "Opportunities"}
      sub={
        locked
          ? "Anything you applied for stays yours - results and notes included."
          : "Scholarships, placements and member benefits from partners we work with. Every applicant hears back, win or lose."
      }
    />
  );

  if (locked) {
    return (
      <>
        {header}
        <EmptyState
          eyebrow="Opportunities"
          message={
            lane === "youth"
              ? "Opportunities are part of adult membership - they open when you turn 18."
              : "Adult events, opportunities and the member directory open once we confirm your date of birth. Write to support@waiorg.me and we will sort it out together - everything else in the portal is already yours."
          }
        />
        {mine !== undefined && mine.length > 0 ? (
          <PanelCard title="My applications" count={`· ${mine.length}`} tight>
            {mine.map((row) => (
              // Read-only rows: results stay visible, the gated board does not.
              <div className="pn-notif" key={row.opportunityId}>
                <span className="row1">
                  <span className="t">
                    {row.title}
                    {row.partner_name !== null ? ` · ${row.partner_name}` : ""}
                  </span>
                  <span className="when">{gulfDate(row.created_at)}</span>
                </span>
                <span className="b">{applicationStateLine(row)}</span>
              </div>
            ))}
          </PanelCard>
        ) : null}
      </>
    );
  }

  return (
    <>
      {header}

      {rows === undefined ? (
        <p className="pn-meta">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          eyebrow="The board"
          message="Nothing open right now. When a partner opportunity opens, it appears here first - and we tell you in your notifications."
        />
      ) : (
        <div className="pn-grid">
          {rows.map((row) => {
            // Mirror of the server's deadline rule: the close cron runs
            // hourly, so a just-passed deadline can still arrive as "open".
            const closed = row.deadline !== null && row.deadline < Date.now();
            const cta =
              row.type === "evergreen"
                ? "How to claim it"
                : row.my_application_state !== null &&
                    row.my_application_state !== "withdrawn"
                  ? "View my application"
                  : closed
                    ? "View"
                    : "View & apply";
            return (
              <div className="pn-card" key={row.opportunityId}>
                <div className="pn-row-head">
                  <span className="pn-tag pn-tag--info">
                    {opportunityTypeWord(row.type)}
                  </span>
                  {row.my_application_state !== null && (
                    <span className={applicationStateTag(row.my_application_state)}>
                      {applicationStateWord(row.my_application_state)}
                    </span>
                  )}
                </div>
                <h2 className="pn-sectitle">{row.title}</h2>
                {row.partner_name !== null && (
                  <p className="pn-meta">With {row.partner_name}</p>
                )}
                <p className="pn-meta">{excerpt(row.description, 160)}</p>
                {row.deadline !== null && (
                  <p className="pn-meta pn-mono">
                    {closed ? "Closed" : "Closes"} {gulfDeadlineLabel(row.deadline)}
                  </p>
                )}
                {row.eligibility_note !== null && (
                  <p className="pn-meta">{row.eligibility_note}</p>
                )}
                <div className="pn-actions">
                  <button
                    type="button"
                    className="pn-btn pn-btn--ghost pn-btn--sm"
                    aria-label={`${cta} - ${row.title}`}
                    onClick={() =>
                      go({ v: "opportunities", id: row.opportunityId })
                    }
                  >
                    {cta}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PanelCard
        title="My applications"
        count={mine === undefined ? undefined : `· ${mine.length}`}
        tight
      >
        {mine === undefined ? (
          <p className="pn-meta pn-loading">Loading…</p>
        ) : mine.length === 0 ? (
          <div className="pn-table-empty">
            <EmptyState
              eyebrow="My applications"
              message="Nothing yet. When you apply, it appears here with its honest state - and every applicant hears back."
            />
          </div>
        ) : (
          mine.map((row) => (
            <button
              type="button"
              className="pn-notif"
              key={row.opportunityId}
              onClick={() => go({ v: "opportunities", id: row.opportunityId })}
            >
              <span className="row1">
                <span className="t">
                  {row.title}
                  {row.partner_name !== null ? ` · ${row.partner_name}` : ""}
                </span>
                <span className="when">{gulfDate(row.created_at)}</span>
              </span>
              <span className="b">{applicationStateLine(row)}</span>
            </button>
          ))
        )}
      </PanelCard>
    </>
  );
}

// One tone per application state everywhere the chip appears (board and
// detail): won earns the ok green, in-play states are sky, closed states
// stay neutral.
export const applicationStateTag = (state: ApplicationState): string =>
  state === "won"
    ? "pn-tag pn-tag--ok"
    : state === "received" || state === "shortlisted"
      ? "pn-tag pn-tag--info"
      : "pn-tag";

// The honest one-liner per application state (vault everyone-gets-an-answer
// rule; "received" always promises the answer).
const applicationStateLine = (row: MyApplicationRow): string => {
  switch (row.state) {
    case "received":
      return "Received - every applicant hears back.";
    case "shortlisted":
      return "Shortlisted - you're in the final group.";
    case "won":
      return `Yours - congratulations.${row.result_note !== null ? ` ${row.result_note}` : ""}`;
    case "lost":
      return `Not this time.${row.result_note !== null ? ` ${row.result_note}` : ""} Thank you for putting yourself forward.`;
    case "withdrawn":
      return "You withdrew this one.";
  }
};
