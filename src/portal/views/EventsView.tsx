import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { DateBlock, EmptyState, PageHeader, PanelCard } from "../../panel/kit";
import { eventCategoryWord, gulfDate, gulfMonthDay, gulfTime } from "../format";
import type { PortalGo, PortalLane } from "../PortalShell";

// The member events list (spec A2): published/postponed events, upcoming
// first, plus the recent past 60 days. The server already applies the youth
// lane rule; this view only words the states honestly.

type EventRows = NonNullable<
  ReturnType<typeof useQuery<typeof api.events.listEvents>>
>;
type EventRow = NonNullable<EventRows>[number];

export function EventsView({
  lane,
  restricted,
  go,
}: {
  lane: PortalLane;
  // restricted_unknown accounts riding the full lane: adult sessions are
  // server-hidden until the date of birth is confirmed.
  restricted: boolean;
  go: PortalGo;
}) {
  const rows = useQuery(api.events.listEvents);
  const upcoming = (rows ?? []).filter((r) => !r.is_past);
  const past = (rows ?? []).filter((r) => r.is_past);

  return (
    <>
      <PageHeader
        eyebrow="Events"
        title="Events"
        sub={
          lane === "youth"
            ? "Sessions for members under 18. RSVP with one tap - if a session is full, you join the waitlist automatically."
            : restricted
              ? (
                  <>
                    Adult sessions open once we confirm your date of birth;
                    sessions for members under 18 appear here. Write to{" "}
                    <a href="mailto:support@waiorg.me">support@waiorg.me</a> and
                    we will sort it out together.
                  </>
                )
              : "Workshops and sessions run by the community. RSVP with one tap - if a session is full, you join the waitlist automatically."
        }
      />

      <PanelCard
        title="Upcoming"
        // No count while loading, and none on the inactive-membership lock:
        // "· 0" beside a locked list reads as an empty one.
        count={
          rows === undefined || rows === null
            ? undefined
            : `· ${upcoming.length}`
        }
        tight
      >
        {rows === undefined ? (
          <p className="pn-meta pn-loading">Loading…</p>
        ) : rows === null ? (
          <p className="pn-meta pn-loading">
            Events open once your membership is active.
          </p>
        ) : upcoming.length === 0 ? (
          <div className="pn-table-empty">
            <EmptyState
              eyebrow="Events"
              message={
                lane === "youth"
                  ? "Nothing scheduled for members under 18 right now. New sessions appear here as soon as they are published."
                  : restricted
                    ? "Nothing you can book yet - adult sessions open once we confirm your date of birth."
                    : "Nothing scheduled right now - new sessions appear here as soon as they are published."
              }
            />
          </div>
        ) : (
          upcoming.map((event) => (
            <EventRowItem key={event.eventId} event={event} go={go} />
          ))
        )}
      </PanelCard>

      {past.length > 0 ? (
        <PanelCard title="Recent past events" count={`· ${past.length}`} tight>
          {past.map((event) => (
            <EventRowItem key={event.eventId} event={event} go={go} past />
          ))}
        </PanelCard>
      ) : null}
    </>
  );
}

function EventRowItem({
  event,
  go,
  past = false,
}: {
  event: EventRow;
  go: PortalGo;
  past?: boolean;
}) {
  const { month, day } = gulfMonthDay(event.starts_at);
  return (
    <div className="pn-event">
      <DateBlock month={month} day={day} />
      <div className="body">
        <div className="head">
          <p className="pn-name">{event.title}</p>
          <MyStateTag state={event.my_state} />
          {past ? null : <CapacityTag event={event} />}
        </div>
        <p className="pn-meta">
          {eventCategoryWord(event.category)} · {gulfDate(event.starts_at)} ·{" "}
          {gulfTime(event.starts_at)} {event.timezone} ·{" "}
          {event.format === "online"
            ? "Online"
            : [event.venue, event.city].filter(Boolean).join(", ") || "In person"}
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
}

function MyStateTag({ state }: { state: EventRow["my_state"] }) {
  if (state === "registered") {
    return <span className="pn-tag pn-tag--ok">Registered</span>;
  }
  if (state === "waitlisted") {
    return <span className="pn-tag pn-tag--info">On the waitlist</span>;
  }
  if (state === "attended") {
    return <span className="pn-tag pn-tag--ok">Attended</span>;
  }
  return null;
}

// The seat situation in plain words. A postponed event keeps taking RSVPs
// (it runs on its new date), so it gets a "New date" note, not "Closed".
function CapacityTag({ event }: { event: EventRow }) {
  const now = Date.now();
  if (event.state === "cancelled") {
    return <span className="pn-tag pn-tag--err">Cancelled</span>;
  }
  if (event.state === "postponed") {
    return <span className="pn-tag pn-tag--info">New date</span>;
  }
  if (
    event.registration_closes_at !== null &&
    now >= event.registration_closes_at
  ) {
    return <span className="pn-tag">Registration closed</span>;
  }
  if (event.capacity !== null && event.registered_count >= event.capacity) {
    return <span className="pn-tag pn-tag--info">Waitlist open</span>;
  }
  return <span className="pn-tag pn-tag--ok">Seats available</span>;
}
