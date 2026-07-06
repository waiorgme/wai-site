import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { AdminEventRow } from "../../../convex/admin/events";
import type { ChipOption, Column } from "../../panel/kit";
import {
  DataTable,
  DateBlock,
  EmptyState,
  FilterChips,
  PageHeader,
  PanelCard,
} from "../../panel/kit";
import type { EventState, Go } from "./shared";
import {
  EVENT_CATEGORY_WORDS,
  EVENT_STATE_WORDS,
  eventStateTagClass,
  fmtGstDateTime,
  gstDayOfMonth,
  gstMonthShort,
} from "./shared";

// Admin events list (panel-experience spec A3): every event in every state,
// newest start first, with live registration counts. Rows open the editor;
// the editor links on to registrations and check-in.

const CHIP_ORDER: ReadonlyArray<EventState> = [
  "draft",
  "published",
  "postponed",
  "cancelled",
  "attendance_finalized",
];

const COLUMNS: ReadonlyArray<Column> = [
  { key: "event", header: "Event" },
  { key: "when", header: "When", width: "190px" },
  { key: "where", header: "Format", width: "130px" },
  { key: "audience", header: "Audience", width: "100px" },
  { key: "seats", header: "Booked", width: "130px" },
  { key: "state", header: "State", width: "120px" },
];

export function EventsView({ go }: { go: Go }) {
  const events = useQuery(api.admin.events.adminListEvents);
  const [filter, setFilter] = useState<"all" | EventState>("all");

  const chips: ChipOption[] =
    events === undefined
      ? [{ key: "all", label: "All" }]
      : [
          { key: "all", label: "All", count: events.length },
          ...CHIP_ORDER.map((state) => ({
            key: state,
            label: EVENT_STATE_WORDS[state],
            count: events.filter((e) => e.state === state).length,
          })),
        ];

  const rows =
    events === undefined
      ? []
      : filter === "all"
        ? events
        : events.filter((e) => e.state === filter);

  const renderCell = (row: AdminEventRow, col: Column) => {
    switch (col.key) {
      case "event":
        return (
          <span className="pn-cell-id">
            <DateBlock
              month={gstMonthShort(row.starts_at)}
              day={gstDayOfMonth(row.starts_at)}
            />
            <span className="pn-cell-2l">
              <span className="t">{row.title}</span>
              <span className="s">{EVENT_CATEGORY_WORDS[row.category]}</span>
            </span>
          </span>
        );
      case "when":
        return <span className="pn-cell-date">{fmtGstDateTime(row.starts_at)}</span>;
      case "where":
        return row.format === "online" ? "Online" : "In person";
      case "audience":
        return row.audience_lane === "youth" ? "Under 18" : "Adults";
      case "seats":
        return (
          <span className="pn-cell-2l">
            <span className="t pn-mono">
              {row.counts.registered}
              {row.capacity !== null ? ` / ${row.capacity}` : ""}
            </span>
            {row.counts.waitlisted > 0 ? (
              <span className="s">{row.counts.waitlisted} on the waiting list</span>
            ) : null}
          </span>
        );
      case "state":
        return (
          <span className={eventStateTagClass(row.state)}>
            {EVENT_STATE_WORDS[row.state]}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Programmes"
        title="Events"
        sub="Publish, run and close every session. Cancelling or moving a published event tells everyone holding a booking."
        actions={
          <button
            type="button"
            className="pn-btn pn-btn--sm"
            onClick={() => go("eventEditor")}
          >
            New event
          </button>
        }
      />
      <PanelCard
        title="All events"
        count={events === undefined ? undefined : `· ${events.length}`}
        tight
      >
        <div className="pn-filterbar">
          <FilterChips
            options={chips}
            active={filter}
            onSelect={(key) => setFilter(key as "all" | EventState)}
            label="Event state filter"
          />
        </div>
        {events === undefined ? (
          <p className="pn-meta pn-loading">Loading…</p>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.eventId}
            renderCell={renderCell}
            onRowClick={(row) => go("eventEditor", row.eventId)}
            empty={
              <EmptyState
                eyebrow="Events"
                message={
                  filter === "all"
                    ? "No events yet. Create the first one and publish it when it is ready."
                    : "No events in this state right now."
                }
                action={
                  filter === "all" ? (
                    <button
                      type="button"
                      className="pn-btn pn-btn--ghost pn-btn--sm"
                      onClick={() => go("eventEditor")}
                    >
                      New event
                    </button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </PanelCard>
    </>
  );
}
