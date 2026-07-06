import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { AdminOverviewCounts } from "../../../convex/admin/overview";
import { EmptyState, PageHeader, PanelCard, ProgressBar, StatTile } from "../../panel/kit";
import type { Go } from "./shared";
import { greetingForHour, gstYear, localDateEyebrow, plural } from "./shared";

// The console Overview v2 (panel-experience spec H17): a time-of-day greeting
// (no name - we do not store the admin's name for this surface), a narrative
// line computed from real counts, KPI tiles, the ranked jump list of waiting
// work, the event-floor counter, quick actions and an audit peek. Everything
// on this page is a number or a jump; nothing here writes.

type QueueKey = "conflicts" | "pipeline" | "guardians" | "dataRequests";

const QUEUE_LABELS: Record<QueueKey, string> = {
  conflicts: "Claim conflicts",
  pipeline: "Pipeline eligibility reviews",
  guardians: "Pending guardians",
  dataRequests: "Data requests",
};

// Busiest queue first; ties keep the fixed order (sort is stable).
const orderedQueues = (
  counts: AdminOverviewCounts,
): Array<{ queue: QueueKey; count: number }> =>
  [
    { queue: "conflicts" as const, count: counts.queue_conflicts },
    { queue: "pipeline" as const, count: counts.queue_pipeline },
    { queue: "guardians" as const, count: counts.queue_guardians },
    { queue: "dataRequests" as const, count: counts.queue_data_requests },
  ].sort((a, b) => b.count - a.count);

export function OverviewV2({
  counts,
  go,
}: {
  counts: AdminOverviewCounts | undefined;
  go: Go;
}) {
  const events = useQuery(api.admin.events.adminListEvents);
  const opportunities = useQuery(api.admin.opportunities.adminListOpportunities);

  const now = Date.now();
  const upcoming =
    events === undefined
      ? undefined
      : events.filter(
          (e) =>
            (e.state === "published" || e.state === "postponed") &&
            e.starts_at > now,
        ).length;
  const openOpportunities =
    opportunities === undefined
      ? undefined
      : opportunities.filter((o) => o.state === "open").length;
  // Applications still waiting on a result, across every listing.
  const appsToReview =
    opportunities === undefined
      ? undefined
      : opportunities.reduce(
          (sum, o) =>
            sum +
            o.application_counts.received +
            o.application_counts.shortlisted,
          0,
        );
  // Sessions that have ended but were never closed out: check-ins to record.
  const endedUnfinalized =
    events === undefined
      ? []
      : events.filter(
          (e) =>
            (e.state === "published" || e.state === "postponed") &&
            e.ends_at < now,
        );
  // Closed listings still owing answers: results to record, then decide.
  const closedUndecided =
    opportunities === undefined
      ? []
      : opportunities.filter(
          (o) => o.state === "closed" && o.type !== "evergreen",
        );

  const queueTotal =
    counts === undefined
      ? undefined
      : counts.queue_conflicts +
        counts.queue_pipeline +
        counts.queue_guardians +
        counts.queue_data_requests;

  // The narrative line, zero-safe: quiet queues say so plainly.
  const narrative = (() => {
    if (counts === undefined || queueTotal === undefined) {
      return "Loading…";
    }
    const parts: string[] = [];
    parts.push(
      queueTotal === 0
        ? "All quiet across the queues."
        : `${plural(queueTotal, "item", "items")} waiting across the review queues.`,
    );
    if (upcoming !== undefined && upcoming > 0) {
      parts.push(`${plural(upcoming, "event", "events")} coming up.`);
    }
    if (appsToReview !== undefined && appsToReview > 0) {
      parts.push(
        `${plural(appsToReview, "application", "applications")} to review.`,
      );
    }
    return parts.join(" ");
  })();

  const nothingWaiting =
    counts !== undefined &&
    queueTotal === 0 &&
    endedUnfinalized.length === 0 &&
    closedUndecided.length === 0;

  return (
    <>
      <PageHeader
        eyebrow={localDateEyebrow(new Date())}
        title={greetingForHour(new Date().getHours())}
        sub={narrative}
      />

      {counts === undefined ? (
        <p className="pn-meta">Loading…</p>
      ) : (
        <div className="pn-stats">
          <StatTile
            label="Active members"
            value={counts.members_active}
            sub="signed up or claimed, email confirmed"
          />
          <StatTile
            label="Waiting on a step"
            value={counts.members_waiting}
            sub="guardian, review or email confirmation"
          />
          <StatTile
            label="Open queue items"
            value={queueTotal ?? 0}
            sub="across the four review queues"
            tone={queueTotal !== undefined && queueTotal > 0 ? "attention" : "default"}
          />
          <StatTile
            label="Upcoming events"
            value={upcoming ?? "…"}
            sub="published, still ahead"
          />
          <StatTile
            label="Open opportunities"
            value={openOpportunities ?? "…"}
            sub="taking applications or claims now"
          />
          <StatTile
            label="Legacy claimed so far"
            value={counts.legacy_claimed}
            sub={`of ${counts.legacy_registered} registered records - registered, never implied active`}
          />
        </div>
      )}

      <div className="pn-cols">
        <div className="main">
          <PanelCard title="Today's queue">
            {counts === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : nothingWaiting ? (
              <EmptyState
                eyebrow="Today"
                message="All quiet. Nothing is waiting on you right now."
              />
            ) : (
              <>
                {orderedQueues(counts).map(({ queue, count }) => (
                  <button
                    key={queue}
                    type="button"
                    className="pn-nav-item"
                    onClick={() => go(queue)}
                  >
                    <span>{QUEUE_LABELS[queue]}</span>
                    <span className={count > 0 ? "n live" : "n"}>
                      {count} waiting
                    </span>
                  </button>
                ))}
                {endedUnfinalized.map((event) => (
                  <button
                    key={event.eventId}
                    type="button"
                    className="pn-nav-item"
                    onClick={() => go("eventRegs", event.eventId)}
                  >
                    <span>Check-ins to record · {event.title}</span>
                    <span className="n live">ended</span>
                  </button>
                ))}
                {closedUndecided.map((opportunity) => (
                  <button
                    key={opportunity.opportunityId}
                    type="button"
                    className="pn-nav-item"
                    onClick={() => go("opportunityEditor", opportunity.opportunityId)}
                  >
                    <span>Results to record · {opportunity.title}</span>
                    <span className="n live">
                      {opportunity.application_counts.received +
                        opportunity.application_counts.shortlisted}{" "}
                      waiting
                    </span>
                  </button>
                ))}
              </>
            )}
          </PanelCard>

          <LatestActions onSeeAll={() => go("audit")} />
        </div>

        <div className="rail">
          <PanelCard title="The event floor">
            {events === undefined ? (
              <p className="pn-meta">Loading…</p>
            ) : (
              <EventFloor events={events} now={now} />
            )}
          </PanelCard>

          <PanelCard title="Quick actions">
            <div className="pn-btn-row">
              <button
                type="button"
                className="pn-btn pn-btn--ghost pn-btn--sm"
                onClick={() => go("eventEditor")}
              >
                New event
              </button>
              <button
                type="button"
                className="pn-btn pn-btn--ghost pn-btn--sm"
                onClick={() => go("opportunityEditor")}
              >
                New opportunity
              </button>
              <button
                type="button"
                className="pn-btn pn-btn--ghost pn-btn--sm"
                onClick={() => go("partnerEditor")}
              >
                New partner
              </button>
              <button
                type="button"
                className="pn-btn pn-btn--ghost pn-btn--sm"
                onClick={() =>
                  go(counts === undefined ? "conflicts" : orderedQueues(counts)[0].queue)
                }
              >
                Review queues
              </button>
            </div>
          </PanelCard>
        </div>
      </div>
    </>
  );
}

// Events delivered this GST calendar year against the monthly floor of twelve.
// Delivered = the session actually ran: closed out, or published and past its
// end time. Drafts and cancellations never count.
function EventFloor({
  events,
  now,
}: {
  events: NonNullable<ReturnType<typeof useQuery<typeof api.admin.events.adminListEvents>>>;
  now: number;
}) {
  const thisYear = gstYear(now);
  const delivered = events.filter(
    (e) =>
      gstYear(e.starts_at) === thisYear &&
      (e.state === "attendance_finalized" ||
        ((e.state === "published" || e.state === "postponed") &&
          e.ends_at < now)),
  ).length;
  return (
    <>
      <ProgressBar
        label="Delivered this year"
        value={(delivered / 12) * 100}
        valueLabel={`${delivered} of 12`}
      />
      <p className="pn-meta">
        The community promise is at least one event every month, twelve in the
        calendar year. Cancelled sessions do not count.
      </p>
    </>
  );
}

// The first page of the audit query as a peek; "See all" jumps to the full
// view. Summaries are PII-free by server contract.
function LatestActions({ onSeeAll }: { onSeeAll: () => void }) {
  const page = useQuery(api.admin.audit.listAdminAuditLog, {});
  return (
    <PanelCard
      title="Latest panel actions"
      actions={
        <button type="button" className="pn-link" onClick={onSeeAll}>
          See all
        </button>
      }
    >
      <p className="pn-meta">
        Every change made here asks you to confirm first, and every change is
        recorded.
      </p>
      {page === undefined ? (
        <p className="pn-meta">Loading…</p>
      ) : page.rows.length === 0 ? (
        <p className="pn-meta">Nothing recorded yet.</p>
      ) : (
        <div className="pn-log">
          {page.rows.slice(0, 5).map((row) => (
            <div key={row.id} className="pn-log-row">
              <span className="pn-when">
                {new Date(row.timestamp).toLocaleString()}
              </span>
              <p className="pn-meta">
                <strong>{row.action}</strong> by {row.actor}
              </p>
              {row.after_summary && <p className="pn-meta">{row.after_summary}</p>}
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}
