import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EmptyState, Modal, PanelCard } from "../../panel/kit";
import {
  downloadIcs,
  eventCategoryWord,
  gulfDate,
  gulfTime,
} from "../format";
import type { PortalGo } from "../PortalShell";
import type { MembershipView } from "./data";

// One event (spec A2): hero-lite card, honest state banners, the description,
// and the "Your seat" card that words every RSVP state plainly - including the
// priority window, the automatic waitlist, and the conduct + recording line
// shown BEFORE she commits. The pass modal reuses the certificate engine's QR
// dependency (qrcode.react), never a new one.

type EventDetail = NonNullable<
  ReturnType<typeof useQuery<typeof api.events.getEvent>>
>;

// Same navy as the certificate face (MembershipCertificate.tsx NAVY).
const QR_NAVY = "#0A1D3F";

const whereLabel = (event: {
  format: "online" | "in_person";
  venue: string | null;
  city: string | null;
}): string =>
  event.format === "online"
    ? "Online"
    : [event.venue, event.city].filter(Boolean).join(", ") || "In person";

export function EventDetailView({
  eventId,
  membership,
  go,
}: {
  eventId: Id<"events">;
  membership: MembershipView;
  go: PortalGo;
}) {
  const event = useQuery(api.events.getEvent, { eventId });

  const crumbs = (
    <nav className="pn-crumbs" aria-label="Breadcrumb">
      <button
        type="button"
        className="pn-crumb"
        onClick={() => go({ v: "events" })}
      >
        Events
      </button>
      <span className="sep">›</span>
      <span aria-current="page">
        {event === undefined || event === null ? "Event" : event.title}
      </span>
    </nav>
  );

  if (event === undefined) {
    return (
      <>
        {crumbs}
        <p className="pn-meta">Loading…</p>
      </>
    );
  }
  if (event === null) {
    return (
      <>
        {crumbs}
        <EmptyState
          eyebrow="Events"
          message="We couldn't find that session - it may have been taken down. Everything that's on is in the events list."
          action={
            <button
              type="button"
              className="pn-btn pn-btn--ghost pn-btn--sm"
              onClick={() => go({ v: "events" })}
            >
              Back to events
            </button>
          }
        />
      </>
    );
  }

  return (
    <>
      {crumbs}

      <section className="pn-hero-card">
        <p className="pn-eyebrow">{eventCategoryWord(event.category)}</p>
        <h1 className="pn-h1">{event.title}</h1>
        <p className="pn-hero-meta">
          <span>{gulfDate(event.starts_at)}</span>
          <span>
            {gulfTime(event.starts_at)} to {gulfTime(event.ends_at)}{" "}
            {event.timezone}
          </span>
          <span>{whereLabel(event)}</span>
        </p>
        {event.host_name !== null && <p>Hosted by {event.host_name}.</p>}
      </section>

      {event.state === "cancelled" && (
        <PanelCard title="Cancelled">
          <p className="pn-meta" role="status">
            This session was cancelled and won't run.
            {event.cancelled_reason !== null
              ? ` ${event.cancelled_reason}`
              : ""}
          </p>
        </PanelCard>
      )}
      {event.state === "postponed" && (
        <PanelCard title="New date">
          <p className="pn-meta" role="status">
            This session was moved. The date and time above are the new ones,
            and your RSVP still counts.
          </p>
        </PanelCard>
      )}

      <PanelCard title="About this session">
        {(event.description ?? event.short_description)
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .map((line, i) => (
            <p className="pn-muted" key={i}>
              {line}
            </p>
          ))}
      </PanelCard>

      <SeatCard event={event} membership={membership} go={go} />

      {(event.recording_url !== null || event.materials_url !== null) && (
        <PanelCard title="Recording and materials">
          <p className="pn-meta">
            For members who took part. Please don't share these outside the
            community.
          </p>
          <div className="pn-actions">
            {event.recording_url !== null && (
              <a
                className="pn-link"
                href={event.recording_url}
                target="_blank"
                rel="noopener"
              >
                Watch the recording
              </a>
            )}
            {event.materials_url !== null && (
              <a
                className="pn-link"
                href={event.materials_url}
                target="_blank"
                rel="noopener"
              >
                Open the materials
              </a>
            )}
          </div>
        </PanelCard>
      )}
    </>
  );
}

// The RSVP card. Every state gets plain words; the button always shows a busy
// state; outcomes land in a role="status" line.
function SeatCard({
  event,
  membership,
  go,
}: {
  event: EventDetail;
  membership: MembershipView;
  go: PortalGo;
}) {
  const rsvp = useMutation(api.events.rsvp);
  const cancelRsvp = useMutation(api.events.cancelMyRsvp);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const now = Date.now();
  const closed =
    event.state === "cancelled" ||
    event.is_past ||
    (event.registration_closes_at !== null &&
      now >= event.registration_closes_at);
  const full =
    event.capacity !== null && event.registered_count >= event.capacity;
  const inPriorityWindow =
    event.priority_window_start !== null &&
    event.priority_window_end !== null &&
    now >= event.priority_window_start &&
    now < event.priority_window_end;
  // Standing gates the priority window only (dated ruling B8). Until the
  // membership query resolves we treat her as plain Member: the server
  // enforces the real rule either way.
  const priorityBlocked =
    inPriorityWindow && (membership?.standing ?? "member") === "member";
  const priorityOpensLabel =
    event.priority_window_end !== null
      ? gulfDate(event.priority_window_end)
      : null;

  const doRsvp = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await rsvp({ eventId: event.eventId });
      if (res.ok) {
        setMessage(
          res.state === "registered"
            ? "You're in. Your seat is confirmed and your pass is ready below."
            : "You're on the waitlist. We'll tell you the moment a seat opens.",
        );
      } else if (res.error === "priority_window") {
        setMessage(
          priorityOpensLabel !== null
            ? `Right now seats are held for members who take part. Seats open to everyone on ${priorityOpensLabel}.`
            : "Right now seats are held for members who take part. They open to everyone shortly.",
        );
      } else if (res.error === "closed") {
        setMessage("Registration closed for this one - sorry.");
      } else {
        setMessage("That didn't work. Please try again.");
      }
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await cancelRsvp({ eventId: event.eventId });
      setMessage(
        res.ok
          ? "Done - your RSVP is cancelled."
          : "We couldn't cancel that. Please try again.",
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  };

  const addToCalendar = () => {
    downloadIcs({
      id: event.eventId,
      title: event.title,
      description: event.short_description,
      location: whereLabel(event),
      startsAt: event.starts_at,
      endsAt: event.ends_at,
    });
  };

  return (
    <PanelCard title="Your seat">
      {event.my_state === "registered" ? (
        <>
          <div className="pn-row-head">
            <span className="pn-tag pn-tag--ok">Registered ✓</span>
            <span className="pn-meta">Your seat is confirmed.</span>
          </div>
          {event.meeting_link !== null && (
            <p className="pn-meta">
              Join online:{" "}
              <a href={event.meeting_link} target="_blank" rel="noopener">
                open the meeting link
              </a>
              .
            </p>
          )}
          <div className="pn-actions">
            <button
              type="button"
              className="pn-btn pn-btn--sm"
              onClick={() => setShowPass(true)}
            >
              My pass
            </button>
            <button
              type="button"
              className="pn-btn pn-btn--ghost pn-btn--sm"
              onClick={addToCalendar}
            >
              Add to calendar
            </button>
            {!closed && (
              <button
                type="button"
                className="pn-link"
                disabled={busy}
                onClick={() => setCancelling(true)}
              >
                Cancel my RSVP
              </button>
            )}
          </div>
        </>
      ) : event.my_state === "waitlisted" ? (
        <>
          <div className="pn-row-head">
            <span className="pn-tag pn-tag--info">On the waitlist</span>
            <span className="pn-meta">
              We'll tell you the moment a seat opens - your spot is saved in
              order.
            </span>
          </div>
          <div className="pn-actions">
            <button
              type="button"
              className="pn-link"
              disabled={busy}
              onClick={() => setCancelling(true)}
            >
              Leave the waitlist
            </button>
          </div>
        </>
      ) : event.my_state === "attended" ? (
        <>
          <div className="pn-row-head">
            <span className="pn-tag pn-tag--ok">Attended</span>
            <span className="pn-meta">
              You were there - taking part counts toward Active Member
              standing.
            </span>
          </div>
        </>
      ) : event.my_state === "no_show" ? (
        <p className="pn-meta">
          You had a seat for this one but weren't checked in. It happens - the
          events list has what's coming next.
        </p>
      ) : closed ? (
        <p className="pn-meta">
          {event.state === "cancelled"
            ? "This session was cancelled, so there's nothing to register for."
            : event.is_past
              ? "This session has already run."
              : "Registration is closed for this one."}
        </p>
      ) : priorityBlocked ? (
        <>
          <p className="pn-muted">
            {priorityOpensLabel !== null
              ? `Seats open to everyone on ${priorityOpensLabel}. `
              : "Seats open to everyone shortly. "}
            Members who take part get early access -{" "}
            <button
              type="button"
              className="pn-link"
              onClick={() => go({ v: "membership" })}
            >
              here's how
            </button>
            .
          </p>
        </>
      ) : (
        <>
          {full && (
            <p className="pn-meta">
              This one is full right now. Joining puts you on the waitlist,
              and we tell you the moment a seat opens.
            </p>
          )}
          <p className="pn-meta">
            Our sessions run on respect - the community code of conduct applies. Sessions may be
            recorded for members; cameras are always optional.
          </p>
          <div className="pn-actions">
            <button
              type="button"
              className="pn-btn"
              disabled={busy}
              onClick={() => void doRsvp()}
            >
              {busy ? "Saving your seat…" : full ? "Join the waitlist" : "RSVP"}
            </button>
          </div>
        </>
      )}

      {message !== null && (
        <p className="pn-meta" role="status">
          {message}
        </p>
      )}

      {cancelling && (
        <Modal
          title={
            event.my_state === "waitlisted"
              ? "Leave the waitlist?"
              : "Give up your seat?"
          }
          sub={`${event.title} · ${gulfDate(event.starts_at)}`}
          onClose={() => setCancelling(false)}
          onConfirm={() => void doCancel()}
          confirmLabel="Yes, cancel it"
          cancelLabel="Keep it"
          confirmDisabled={busy}
          footNote="If someone is waiting, your seat goes straight to the first person on the waitlist."
        />
      )}

      {showPass && (
        <PassModal eventId={event.eventId} onClose={() => setShowPass(false)} />
      )}
    </PanelCard>
  );
}

// The event pass: her name, WAIME number and the QR of her check-in code.
function PassModal({
  eventId,
  onClose,
}: {
  eventId: Id<"events">;
  onClose: () => void;
}) {
  const pass = useQuery(api.events.getMyEventPass, { eventId });
  return (
    <Modal
      title="My pass"
      sub={pass === undefined || pass === null ? undefined : pass.title}
      onClose={onClose}
      onConfirm={onClose}
      confirmLabel="Done"
      hideCancel
    >
      {pass === undefined ? (
        <p className="pn-meta">Loading your pass…</p>
      ) : pass === null ? (
        <p className="pn-meta">
          We couldn't load your pass just now. Close this and try again, or
          email <a href="mailto:support@waiorg.me">support@waiorg.me</a>.
        </p>
      ) : (
        <div className="pn-pass">
          <p className="nm">{pass.memberName}</p>
          <p className="pn-meta pn-mono">
            {pass.membershipNumber !== null
              ? `WAIME-${pass.membershipNumber}`
              : "Membership number on its way"}
          </p>
          <span className="qr">
            <QRCodeSVG
              value={pass.checkin_code}
              size={168}
              fgColor={QR_NAVY}
              bgColor="#fff"
            />
          </span>
          <p className="pn-meta">
            Show this at the door - we scan it to check you in.
          </p>
          <p className="pn-meta pn-mono">
            {gulfDate(pass.starts_at)} · {gulfTime(pass.starts_at)}{" "}
            {pass.timezone} ·{" "}
            {whereLabel({
              format: pass.format,
              venue: pass.venue,
              city: pass.city,
            })}
          </p>
        </div>
      )}
    </Modal>
  );
}
