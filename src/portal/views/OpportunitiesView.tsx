import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { EmptyState, PageHeader, PanelCard } from "../../panel/kit";
import {
  applicationStateWord,
  excerpt,
  gulfDate,
  gulfDeadlineLabel,
  opportunityTypeWord,
} from "../format";
import type { PortalGo } from "../PortalShell";

// The opportunities board (spec B6): open listings she is eligible for, typed
// in plain words, deadlines in the "11:59 PM GST" convention, plus her own
// applications with honest state words. The server decides eligibility; a
// restricted (unknown-age) lane gets the honest locked line instead of a
// dishonest "nothing open".

type BoardRows = ReturnType<typeof useQuery<typeof api.opportunities.listOpportunities>>;
type MyApplications = ReturnType<typeof useQuery<typeof api.opportunities.myApplications>>;
type MyApplicationRow = NonNullable<MyApplications>[number];

export function OpportunitiesView({
  restricted,
  go,
}: {
  restricted: boolean;
  go: PortalGo;
}) {
  const rows: BoardRows = useQuery(
    api.opportunities.listOpportunities,
    restricted ? "skip" : {},
  );
  const mine: MyApplications = useQuery(
    api.opportunities.myApplications,
    restricted ? "skip" : {},
  );

  const header = (
    <PageHeader
      eyebrow="Opportunities"
      title="Opportunities"
      sub="Scholarships, placements and member benefits from partners we work with. Every applicant hears back, win or lose."
    />
  );

  if (restricted) {
    return (
      <>
        {header}
        <EmptyState
          eyebrow="Opportunities"
          message="Opportunities open when you turn 18. Everything else in the portal is already yours."
        />
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
          {rows.map((row) => (
            <div className="pn-card" key={row.opportunityId}>
              <div className="pn-row-head">
                <span className="pn-tag pn-tag--info">
                  {opportunityTypeWord(row.type)}
                </span>
                {row.my_application_state !== null && (
                  <span
                    className={
                      row.my_application_state === "won"
                        ? "pn-tag pn-tag--ok"
                        : "pn-tag"
                    }
                  >
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
                  Closes {gulfDeadlineLabel(row.deadline)}
                </p>
              )}
              {row.eligibility_note !== null && (
                <p className="pn-meta">{row.eligibility_note}</p>
              )}
              <div className="pn-actions">
                <button
                  type="button"
                  className="pn-btn pn-btn--ghost pn-btn--sm"
                  onClick={() =>
                    go({ v: "opportunities", id: row.opportunityId })
                  }
                >
                  {row.type === "evergreen" ? "How to claim it" : "View & apply"}
                </button>
              </div>
            </div>
          ))}
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
          ))
        )}
      </PanelCard>
    </>
  );
}

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
