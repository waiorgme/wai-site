import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AdminRegistrationRow } from "../../../convex/admin/events";
import type { Column } from "../../panel/kit";
import {
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  PanelCard,
  SearchInput,
  StatTile,
} from "../../panel/kit";
import type { Go } from "./shared";
import {
  fmtGstDate,
  fmtGstDateTime,
  initials,
  REG_STATE_WORDS,
  regStateTagClass,
} from "./shared";

// Registrations + check-in for one event (panel-experience spec A3). The desk
// sees names, never contact details (safeguarding rule). Attendance is
// producer-marked: Mark attended / No show are propose-then-confirm and
// idempotent, corrections stay possible until Finalize attendance closes the
// event for good.

const COLUMNS: ReadonlyArray<Column> = [
  { key: "who", header: "Member" },
  { key: "state", header: "State", width: "160px" },
  { key: "booked", header: "Booked", width: "120px" },
  { key: "actions", header: "Check-in", width: "300px" },
];

export function EventRegistrationsView({
  eventId,
  go,
}: {
  eventId: Id<"events">;
  go: Go;
}) {
  const detail = useQuery(api.admin.events.getEventAdmin, { eventId });
  const rows = useQuery(api.admin.events.listRegistrations, { eventId });
  const finalize = useMutation(api.admin.events.finalizeAttendance);
  const checkIn = useMutation(api.admin.events.checkIn);

  const [q, setQ] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  if (detail === undefined || rows === undefined) {
    return <p className="pn-meta">Loading…</p>;
  }
  if (detail === null) {
    return <p className="pn-meta">This event no longer exists.</p>;
  }

  const finalized = detail.state === "attendance_finalized";
  const canMark = detail.state === "published" || detail.state === "postponed";
  const needle = q.trim().toLowerCase();
  const filtered =
    needle === ""
      ? rows
      : rows.filter((r) => r.name.toLowerCase().includes(needle));

  const onFinalize = async () => {
    setBusy(true);
    try {
      const res = await finalize({ eventId });
      setOutcome(
        res.ok
          ? {
              ok: true,
              message: res.already === true
                ? "Attendance was already final."
                : "Done. Attendance is final and the event is closed.",
            }
          : {
              ok: false,
              message:
                res.error === "invalid_state"
                  ? "Only a published or postponed event can be closed out."
                  : "That did not go through. Please try again.",
            },
      );
    } catch {
      setOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
      setFinalizing(false);
    }
  };

  const markByCode = async (outcomeKind: "attended" | "no_show") => {
    setBusy(true);
    try {
      const res = await checkIn({ eventId, checkinCode: q.trim(), outcome: outcomeKind });
      setOutcome(
        res.ok
          ? {
              ok: true,
              message: res.already === true
                ? `That pass was already marked ${res.state === "attended" ? "attended" : "as a no show"}.`
                : `Marked ${res.state === "attended" ? "attended" : "as a no show"} by pass code.`,
            }
          : {
              ok: false,
              message:
                res.error === "not_found"
                  ? "That code does not match a live booking."
                  : res.error === "not_seated"
                    ? "That member is on the waiting list - a seat has to open before she can be checked in."
                    : res.error === "invalid_state"
                      ? "This event is not open for check-in."
                      : "That did not go through. Please try again.",
            },
      );
      if (res.ok) {
        setQ("");
      }
    } catch {
      setOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const renderCell = (row: AdminRegistrationRow, col: Column) => {
    switch (col.key) {
      case "who":
        return (
          <span className="pn-cell-id">
            <span className="pn-initials">{initials(row.name)}</span>
            <span className="pn-cell-2l">
              <span className="t">{row.name}</span>
              {row.promoted_from_waitlist_at !== null ? (
                <span className="s">Promoted from the waiting list</span>
              ) : null}
            </span>
          </span>
        );
      case "state":
        return (
          <span className={regStateTagClass(row.state)}>
            {REG_STATE_WORDS[row.state]}
          </span>
        );
      case "booked":
        return <span className="pn-cell-date">{fmtGstDate(row.created_at)}</span>;
      case "actions":
        if (row.state === "cancelled") {
          return <span className="pn-meta">Cancelled her booking</span>;
        }
        // A waitlisted member never got a seat, so there is nothing to check
        // in: a seat has to free first, which promotes her automatically
        // (Gate 4 round 8). No mark buttons on a waitlisted row.
        if (row.state === "waitlisted") {
          return (
            <span className="pn-meta">
              On the waiting list - a seat must open before she can attend
            </span>
          );
        }
        if (!canMark) {
          return (
            <span className="pn-meta">
              {finalized ? "Attendance is final" : "Not open for check-in"}
            </span>
          );
        }
        return <MarkCell row={row} eventId={eventId} />;
      default:
        return null;
    }
  };

  return (
    <>
      <nav className="pn-crumbs" aria-label="Breadcrumb">
        <button type="button" className="pn-crumb" onClick={() => go("events")}>
          Events
        </button>
        <span className="sep">›</span>
        <button
          type="button"
          className="pn-crumb"
          onClick={() => go("eventEditor", eventId)}
        >
          {detail.title}
        </button>
        <span className="sep">›</span>
        <span aria-current="page">Registrations</span>
      </nav>

      <PageHeader
        eyebrow={fmtGstDateTime(detail.starts_at)}
        title="Registrations and check-in"
        sub={`${detail.title} · ${detail.counts.registered} registered${detail.capacity !== null ? ` of ${detail.capacity} seats` : ""} · ${detail.counts.waitlisted} on the waiting list`}
        actions={
          finalized ? undefined : (
            <button
              type="button"
              className="pn-btn pn-btn--sm"
              disabled={busy || !canMark}
              onClick={() => setFinalizing(true)}
            >
              Finalize attendance
            </button>
          )
        }
      />

      {outcome !== null ? (
        <p role="status" className={outcome.ok ? "pn-ok" : "pn-error"}>
          {outcome.message}
        </p>
      ) : null}

      <div className="pn-stats">
        <StatTile label="Registered" value={detail.counts.registered} />
        <StatTile label="Waiting list" value={detail.counts.waitlisted} />
        <StatTile label="Attended" value={detail.counts.attended} />
        <StatTile label="No show" value={detail.counts.no_show} />
      </div>

      <PanelCard title="Who's here" count={`· ${rows.length}`} tight>
        <div className="pn-filterbar">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Search by name or pass code"
          />
        </div>
        {filtered.length === 0 && needle !== "" && canMark ? (
          <div className="pn-table-empty">
            <div className="pn-stack">
              <p className="pn-meta">
                No name matches. If this is a pass code from a member's event
                pass, mark it directly:
              </p>
              <div className="pn-btn-row">
                <button
                  type="button"
                  className="pn-btn pn-btn--sm"
                  disabled={busy}
                  onClick={() => void markByCode("attended")}
                >
                  {busy ? "Working…" : "Mark attended by code"}
                </button>
                <button
                  type="button"
                  className="pn-btn pn-btn--ghost pn-btn--sm"
                  disabled={busy}
                  onClick={() => void markByCode("no_show")}
                >
                  No show by code
                </button>
              </div>
            </div>
          </div>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={filtered}
            rowKey={(row) => row.registrationId}
            renderCell={renderCell}
            empty={
              <EmptyState
                eyebrow="Registrations"
                message="No bookings yet. Members appear here the moment they RSVP."
              />
            }
          />
        )}
      </PanelCard>

      {finalizing ? (
        <Modal
          title="Finalize attendance"
          sub={detail.title}
          onClose={() => setFinalizing(false)}
          onConfirm={() => void onFinalize()}
          confirmLabel={busy ? "Working…" : "Yes, close it out"}
          confirmDisabled={busy}
          footNote="Recorded in the audit log. Attendance can no longer be changed after this."
        >
          <p className="pn-meta">
            This closes the event for good: no more check-ins, no more
            corrections. Attended marks count toward each member's standing.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

// Per-row producer marking: propose-then-confirm, and the buttons come back
// after each result so a wrong tap can be corrected until finalize.
function MarkCell({ row, eventId }: { row: AdminRegistrationRow; eventId: Id<"events"> }) {
  const checkIn = useMutation(api.admin.events.checkIn);
  const [proposing, setProposing] = useState<"attended" | "no_show" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const confirm = async () => {
    if (proposing === null) {
      return;
    }
    setBusy(true);
    try {
      const res = await checkIn({
        eventId,
        registrationId: row.registrationId,
        outcome: proposing,
      });
      if (res.ok) {
        setMessage({
          ok: true,
          text: res.already === true
            ? `Already ${res.state === "attended" ? "marked attended" : "a no show"}.`
            : res.state === "attended"
              ? "Marked attended."
              : "Marked as a no show.",
        });
      } else {
        setMessage({
          ok: false,
          text:
            res.error === "not_seated"
              ? "She's on the waiting list - a seat has to open first."
              : res.error === "invalid_state"
                ? "This event is not open for check-in."
                : "That did not go through. Please try again.",
        });
      }
    } catch {
      setMessage({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
      setProposing(null);
    }
  };

  if (proposing !== null) {
    return (
      <span className="pn-btn-row">
        <span className="pn-meta">
          {proposing === "attended" ? "Mark her attended?" : "Mark her as a no show?"}
        </span>
        <button
          type="button"
          className="pn-btn pn-btn--sm"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? "Working…" : "Yes"}
        </button>
        <button
          type="button"
          className="pn-link"
          disabled={busy}
          onClick={() => setProposing(null)}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="pn-btn-row">
      {row.state !== "attended" ? (
        <button
          type="button"
          className="pn-link"
          onClick={() => setProposing("attended")}
        >
          Mark attended
        </button>
      ) : null}
      {row.state !== "no_show" ? (
        <button
          type="button"
          className="pn-link"
          onClick={() => setProposing("no_show")}
        >
          No show
        </button>
      ) : null}
      {message !== null ? (
        <span role="status" className={message.ok ? "pn-ok" : "pn-error"}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
