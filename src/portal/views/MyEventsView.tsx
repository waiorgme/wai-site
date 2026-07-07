import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  DateBlock,
  EmptyState,
  Modal,
  PageHeader,
  PanelCard,
} from "../../panel/kit";
import { eventCategoryWord, gulfDate, gulfMonthDay, gulfTime } from "../format";
import type { PortalGo } from "../PortalShell";

// My events (spec A2): her own registrations - upcoming with a cancel action,
// past with honest attendance marks. Cancelled RSVPs never appear (the server
// filters them out).

type MyEventRows = NonNullable<
  ReturnType<typeof useQuery<typeof api.events.myEvents>>
>;
type MyEventRow = MyEventRows[number];

export function MyEventsView({ go }: { go: PortalGo }) {
  const rows = useQuery(api.events.myEvents);
  const cancelRsvp = useMutation(api.events.cancelMyRsvp);
  const [cancelling, setCancelling] = useState<MyEventRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const upcoming = (rows ?? []).filter((r) => !r.is_past);
  // The server sorts ascending; past reads most-recent-first, like EventsView.
  const past = (rows ?? [])
    .filter((r) => r.is_past)
    .sort((a, b) => b.starts_at - a.starts_at);

  const doCancel = async (row: MyEventRow) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await cancelRsvp({ eventId: row.eventId });
      setMessage(
        res.ok
          ? `Done - your RSVP for ${row.title} is cancelled.`
          : "We couldn't cancel that. Please try again.",
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setCancelling(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="My events"
        title="My events"
        sub="Your seats, waitlist spots and past sessions, in one place."
      />

      {message !== null && (
        <p className="pn-meta" role="status">
          {message}
        </p>
      )}

      <PanelCard
        title="Upcoming"
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
              eyebrow="My events"
              message="You haven't signed up for anything yet. Browse the events list - one tap saves your seat."
              action={
                <button
                  type="button"
                  className="pn-btn pn-btn--ghost pn-btn--sm"
                  onClick={() => go({ v: "events" })}
                >
                  Browse events
                </button>
              }
            />
          </div>
        ) : (
          upcoming.map((row) => {
            const { month, day } = gulfMonthDay(row.starts_at);
            return (
              <div className="pn-event" key={row.eventId}>
                <DateBlock month={month} day={day} />
                <div className="body">
                  <div className="head">
                    <p className="pn-name">{row.title}</p>
                    {row.my_state === "registered" ? (
                      <span className="pn-tag pn-tag--ok">Registered</span>
                    ) : row.my_state === "waitlisted" ? (
                      <span className="pn-tag pn-tag--info">
                        On the waitlist
                      </span>
                    ) : null}
                    {row.event_state === "postponed" && (
                      <span className="pn-tag pn-tag--info">New date</span>
                    )}
                    {row.event_state === "cancelled" && (
                      <span className="pn-tag pn-tag--err">Cancelled</span>
                    )}
                  </div>
                  <p className="pn-meta">
                    {eventCategoryWord(row.category)} ·{" "}
                    {gulfDate(row.starts_at)} · {gulfTime(row.starts_at)}{" "}
                    {row.timezone} ·{" "}
                    {row.format === "online"
                      ? "Online"
                      : [row.venue, row.city].filter(Boolean).join(", ") ||
                        "In person"}
                  </p>
                </div>
                <div className="end">
                  <button
                    type="button"
                    className="pn-btn pn-btn--ghost pn-btn--sm"
                    onClick={() => go({ v: "events", id: row.eventId })}
                  >
                    View
                  </button>
                  {row.event_state !== "cancelled" && (
                    <button
                      type="button"
                      className="pn-link"
                      disabled={busy}
                      onClick={() => setCancelling(row)}
                    >
                      Cancel RSVP
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </PanelCard>

      {rows !== undefined && past.length > 0 && (
        <PanelCard title="Past" count={`· ${past.length}`} tight>
          {past.map((row) => {
            const { month, day } = gulfMonthDay(row.starts_at);
            return (
              <div className="pn-event" key={row.eventId}>
                <DateBlock month={month} day={day} />
                <div className="body">
                  <div className="head">
                    <p className="pn-name">{row.title}</p>
                    <PastStateTag state={row.my_state} />
                  </div>
                  <p className="pn-meta">
                    {eventCategoryWord(row.category)} ·{" "}
                    {gulfDate(row.starts_at)}
                  </p>
                </div>
                <div className="end">
                  <button
                    type="button"
                    className="pn-btn pn-btn--ghost pn-btn--sm"
                    onClick={() => go({ v: "events", id: row.eventId })}
                  >
                    View
                  </button>
                </div>
              </div>
            );
          })}
        </PanelCard>
      )}

      {cancelling !== null && (
        <Modal
          title={
            cancelling.my_state === "waitlisted"
              ? "Leave the waitlist?"
              : "Give up your seat?"
          }
          sub={`${cancelling.title} · ${gulfDate(cancelling.starts_at)}`}
          onClose={() => setCancelling(null)}
          onConfirm={() => void doCancel(cancelling)}
          confirmLabel={
            cancelling.my_state === "waitlisted"
              ? "Yes, leave it"
              : "Yes, cancel it"
          }
          cancelLabel="Keep it"
          confirmDisabled={busy}
          // A waitlisted member holds no seat, so the seat-passes-on note is
          // only true for a registered one.
          footNote={
            cancelling.my_state === "registered"
              ? "If someone is waiting, your seat goes straight to the first person on the waitlist."
              : undefined
          }
        />
      )}
    </>
  );
}

// Honest attendance words for past rows: attended is a quiet win, a no-show
// is stated kindly, an unfinalised registration stays what it was.
function PastStateTag({ state }: { state: MyEventRow["my_state"] }) {
  if (state === "attended") {
    return <span className="pn-tag pn-tag--ok">Attended</span>;
  }
  if (state === "no_show") {
    return <span className="pn-tag">Couldn't make it</span>;
  }
  if (state === "registered") {
    return <span className="pn-tag">Was registered</span>;
  }
  if (state === "waitlisted") {
    return <span className="pn-tag">Was on the waitlist</span>;
  }
  return null;
}
