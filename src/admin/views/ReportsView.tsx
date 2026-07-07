import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { PlatformHealth } from "../../../convex/admin/overview";
import { PageHeader, PanelCard, ProgressBar, StatTile } from "../../panel/kit";
import type { Lifecycle } from "./shared";
import { fmtGstDate, LIFECYCLE_WORDS } from "./shared";

// Reports (panel-experience spec H18): sanctioned aggregates ONLY, composed
// from the queries this console already has plus getReportAggregates
// (pipeline opt-in count, active members by country / career stage). No
// individuals, no export buttons - exports stay with the gated data-request
// path. The old-list card keeps the vault integrity rule: the imported list
// is registered, never implied active.

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
  // Aggregate-only by contract (spec H18): every number arrives as a count
  // from the server. This route never calls a row-listing query, so no
  // individual record ever rides into the reports page.
  const counts = useQuery(api.admin.overview.getAdminOverview);
  const aggregates = useQuery(api.admin.overview.getReportAggregates);
  const health = useQuery(api.admin.overview.getPlatformHealth);
  const stats = useQuery(api.admin.overview.getReportStats);

  const delivered = stats?.events.delivered_this_year;
  const attendanceTotal = stats?.events.attendance_total;
  const posted = stats?.opportunities.posted;
  const applicationsTotal = stats?.opportunities.applications_total;
  const resultsRecorded = stats?.opportunities.results_recorded;

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Reports"
        sub="Aggregates only - reading this page never touches an individual record, and exports stay with the gated data-request path."
      />

      <div className="pn-cols">
        <div className="main">
          <PanelCard title="From the old list to active members">
            {counts === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : (
              <>
                <ProgressBar
                  label="Registered (the imported list)"
                  value={counts.legacy_registered > 0 ? 100 : 0}
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
                  Being on the old imported list only means registered. A
                  member counts as active once she has confirmed her own
                  account - that includes brand-new signups, so Active can be
                  larger than Claimed.
                </p>
              </>
            )}
          </PanelCard>

          <PanelCard title="Join funnel">
            {health === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : health.funnel.join_submitted === 0 ? (
              <p className="pn-meta">
                No joins recorded yet - the funnel starts counting with the
                first Join form submission on the new site.
              </p>
            ) : (
              <>
                <ProgressBar
                  label="Joined (form submitted)"
                  value={100}
                  valueLabel={String(health.funnel.join_submitted)}
                />
                <ProgressBar
                  label="Confirmed her email"
                  value={
                    (health.funnel.email_confirmed /
                      health.funnel.join_submitted) *
                    100
                  }
                  valueLabel={String(health.funnel.email_confirmed)}
                />
                <ProgressBar
                  label="Started her profile"
                  value={
                    (health.funnel.onboarding_started /
                      health.funnel.join_submitted) *
                    100
                  }
                  valueLabel={String(health.funnel.onboarding_started)}
                />
                <p className="pn-meta">
                  Everyone who joined through the new site, under-18 members
                  included. Members claiming their old-list record are counted
                  in the card above, not here.
                </p>
              </>
            )}
          </PanelCard>

          <PanelCard title="Members by status">
            {stats === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : (
              <MembersByStatus lifecycleCounts={stats.members.lifecycle_counts} />
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
                sub="marked at the event door, all time"
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

          <PanelCard title="Platform health check">
            {health === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : (
              <HealthCheck health={health} />
            )}
          </PanelCard>
        </div>
      </div>
    </>
  );
}

/* ---------- the four kill-criteria counters (PRD §13) ---------- */

// Plain words per counter, honest before launch: measures that cannot mean
// anything yet say so instead of alarming. The settled rule is stated in
// full at the bottom so the numbers never float without their meaning.
function HealthCheck({ health }: { health: PlatformHealth }) {
  const k = health.kill_criteria;
  // Before the review date is set (an owner action at launch), red tags
  // would only shout about a platform that has not started - stay neutral.
  const live = health.review_at !== null;
  return (
    <>
      <HealthRow
        label="Old-list claim rate"
        detail={
          k.claim_rate.pct === null
            ? "Starts counting when the old list is imported."
            : `${k.claim_rate.pct}% claimed (${k.claim_rate.claimed} of ${k.claim_rate.registered}). Watch level: below ${k.claim_rate.threshold_pct}%.`
        }
        missed={live ? k.claim_rate.missed : null}
      />
      <HealthRow
        label="Monthly event"
        detail={`${6 - k.event_floor.months_missed} of the last ${k.event_floor.months_checked} full months had a session that ran. Watch level: 2 or more months without one.`}
        missed={live ? k.event_floor.missed : null}
      />
      <HealthRow
        label="Corporate partners"
        detail={
          k.corporate_partners.active_count === 0
            ? "No active partner yet."
            : `${k.corporate_partners.active_count} active ${k.corporate_partners.active_count === 1 ? "partner" : "partners"}.`
        }
        missed={live ? k.corporate_partners.missed : null}
      />
      <HealthRow
        label="Monthly active members"
        detail={
          k.monthly_active.pct === null
            ? "Starts counting with the first claimed members."
            : `${k.monthly_active.active_30d} members active in the last 30 days - ${k.monthly_active.pct}% of claimed. Watch level: below ${k.monthly_active.threshold_pct}%.`
        }
        missed={live ? k.monthly_active.missed : null}
      />
      <p className="pn-meta">
        The settled rule: if two or more of these are missed at the fixed
        six-month review, pause heavy platform building and rethink. WAI-ME
        itself is never in question - only where build effort goes.{" "}
        {health.review_at !== null
          ? `Review date: ${fmtGstDate(health.review_at)}.`
          : "The review date is set at launch."}
      </p>
    </>
  );
}

function HealthRow({
  label,
  detail,
  missed,
}: {
  label: string;
  detail: string;
  // null = not meaningful yet (pre-launch or no data): neutral tag.
  missed: boolean | null;
}) {
  return (
    <div className="pn-row-head">
      <span
        className={
          missed === null
            ? "pn-tag"
            : missed
              ? "pn-tag pn-tag--err"
              : "pn-tag pn-tag--ok"
        }
      >
        {missed === null ? "Not started" : missed ? "Missed" : "On track"}
      </span>
      <span className="pn-meta">
        <strong>{label}.</strong> {detail}
      </span>
    </div>
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
