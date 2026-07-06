import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageHeader, PanelCard, ProgressBar, StatTile } from "../../panel/kit";
import type { Lifecycle } from "./shared";
import { gstYear, LIFECYCLE_WORDS } from "./shared";

// Reports (panel-experience spec H18): sanctioned aggregates ONLY, composed
// from the queries this console already has plus getReportAggregates
// (pipeline opt-in count, active members by country / career stage). No
// individuals, no export buttons - exports stay with the gated data-request
// path. The activation funnel keeps the vault integrity rule word for word:
// the imported list is registered, never implied active.

const LIFECYCLE_ORDER: ReadonlyArray<Lifecycle> = [
  "active",
  "email_unverified",
  "consent_pending",
  "pending_guardian",
  "claim_pending",
  "pending_review",
  "dormant",
  "suspended",
  "erasure_requested",
  "erasure_in_progress",
  "archived",
];

export function ReportsView() {
  const counts = useQuery(api.admin.overview.getAdminOverview);
  const aggregates = useQuery(api.admin.overview.getReportAggregates);
  const events = useQuery(api.admin.events.adminListEvents);
  const opportunities = useQuery(api.admin.opportunities.adminListOpportunities);
  // Fetched for its lifecycle_counts aggregate only.
  const members = useQuery(api.admin.members.listMembers, {});

  const now = Date.now();
  const thisYear = gstYear(now);
  const delivered =
    events === undefined
      ? undefined
      : events.filter(
          (e) =>
            gstYear(e.starts_at) === thisYear &&
            (e.state === "attendance_finalized" ||
              ((e.state === "published" || e.state === "postponed") &&
                e.ends_at < now)),
        ).length;
  const attendanceTotal =
    events === undefined
      ? undefined
      : events.reduce((sum, e) => sum + e.counts.attended, 0);
  const posted =
    opportunities === undefined
      ? undefined
      : opportunities.filter((o) => o.state !== "draft").length;
  const applicationsTotal =
    opportunities === undefined
      ? undefined
      : opportunities.reduce((sum, o) => sum + o.application_counts.active, 0);
  const resultsRecorded =
    opportunities === undefined
      ? undefined
      : opportunities.reduce(
          (sum, o) => sum + o.application_counts.won + o.application_counts.lost,
          0,
        );

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Reports"
        sub="Aggregates only - reading this page never touches an individual record, and exports stay with the gated data-request path."
      />

      <div className="pn-cols">
        <div className="main">
          <PanelCard title="Activation funnel">
            {counts === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : (
              <>
                <ProgressBar
                  label="Registered (the imported list)"
                  value={100}
                  valueLabel={String(counts.legacy_registered)}
                />
                <ProgressBar
                  label="Claimed"
                  value={
                    counts.legacy_registered === 0
                      ? 0
                      : (counts.legacy_claimed / counts.legacy_registered) * 100
                  }
                  valueLabel={String(counts.legacy_claimed)}
                />
                <ProgressBar
                  label="Active members"
                  value={
                    counts.legacy_registered === 0
                      ? counts.members_active > 0
                        ? 100
                        : 0
                      : Math.min(
                          100,
                          (counts.members_active / counts.legacy_registered) * 100,
                        )
                  }
                  valueLabel={String(counts.members_active)}
                />
                <p className="pn-meta">
                  The rule this page keeps: the imported list is registered,
                  never implied active. Active counts every confirmed member,
                  new signups included, so it is not a slice of the imported
                  list.
                </p>
              </>
            )}
          </PanelCard>

          <PanelCard title="Members by status">
            {members === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : (
              <MembersByStatus lifecycleCounts={members.lifecycle_counts} />
            )}
          </PanelCard>

          <PanelCard title="Active members by country">
            {aggregates === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : aggregates.by_country.length === 0 ? (
              <p className="pn-meta">No country data yet.</p>
            ) : (
              <FacetBars
                rows={aggregates.by_country}
                footnote="Top countries of residence, active members only."
              />
            )}
          </PanelCard>

          <PanelCard title="Active members by career stage">
            {aggregates === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : aggregates.by_career_stage.length === 0 ? (
              <p className="pn-meta">No career stage data yet.</p>
            ) : (
              <FacetBars
                rows={aggregates.by_career_stage}
                footnote="Where active members are in aviation right now."
              />
            )}
          </PanelCard>
        </div>

        <div className="rail">
          <PanelCard title="Events">
            <div className="pn-stats">
              <StatTile
                label="Delivered this year"
                value={delivered ?? "…"}
                sub="sessions that actually ran"
              />
              <StatTile
                label="Attendance marks"
                value={attendanceTotal ?? "…"}
                sub="producer-marked, all time"
              />
            </div>
          </PanelCard>

          <PanelCard title="Opportunities">
            <div className="pn-stats">
              <StatTile
                label="Posted"
                value={posted ?? "…"}
                sub="listings that went live"
              />
              <StatTile
                label="Applications"
                value={applicationsTotal ?? "…"}
                sub="live and settled, withdrawals excluded"
              />
              <StatTile
                label="Results recorded"
                value={resultsRecorded ?? "…"}
                sub="every applicant gets an answer"
              />
            </div>
          </PanelCard>

          <PanelCard title="Talent pipeline">
            <div className="pn-stats">
              <StatTile
                label="Opted in and approved"
                value={aggregates?.pipeline_on ?? "…"}
                sub="members trusted partners can be introduced to"
              />
            </div>
          </PanelCard>
        </div>
      </div>
    </>
  );
}

// Horizontal aggregate bars for a facet (country, career stage): counts only,
// scaled to the largest bucket.
function FacetBars({
  rows,
  footnote,
}: {
  rows: Array<{ label: string; count: number }>;
  footnote: string;
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <>
      {rows.map((row) => (
        <ProgressBar
          key={row.label}
          label={row.label}
          value={(row.count / max) * 100}
          valueLabel={String(row.count)}
        />
      ))}
      <p className="pn-meta">{footnote}</p>
    </>
  );
}

function MembersByStatus({
  lifecycleCounts,
}: {
  lifecycleCounts: Record<string, number>;
}) {
  const total = Object.values(lifecycleCounts).reduce((sum, n) => sum + n, 0);
  if (total === 0) {
    return <p className="pn-meta">No member records yet.</p>;
  }
  return (
    <>
      {LIFECYCLE_ORDER.filter((state) => (lifecycleCounts[state] ?? 0) > 0).map(
        (state) => (
          <ProgressBar
            key={state}
            label={LIFECYCLE_WORDS[state]}
            value={((lifecycleCounts[state] ?? 0) / total) * 100}
            valueLabel={String(lifecycleCounts[state] ?? 0)}
          />
        ),
      )}
      <p className="pn-meta">{total} records in total.</p>
    </>
  );
}
