import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AdminEventDetail } from "../../../convex/admin/events";
import { Modal, PageHeader, PanelCard } from "../../panel/kit";
import type { EventCategory, EventState, Go } from "./shared";
import {
  EVENT_CATEGORY_WORDS,
  EVENT_STATE_WORDS,
  eventStateTagClass,
  fmtGstDateTime,
  gstInputValue,
  msFromGstInput,
  orUndef,
} from "./shared";

// Event create/edit (panel-experience spec A3). The form is light on
// validation - the server is authoritative - and submits the FULL field set
// (server contract: an omitted optional field clears). Publish, cancel and
// postpone are modal-grade propose-then-confirm; cancelled and closed events
// are read-only history.

const CATEGORY_KEYS = Object.keys(EVENT_CATEGORY_WORDS) as EventCategory[];

type FormState = {
  title: string;
  category: EventCategory;
  short_description: string;
  description: string;
  starts: string;
  ends: string;
  format: "online" | "in_person";
  meeting_link: string;
  venue: string;
  city: string;
  host_name: string;
  host_email: string;
  audience_lane: "adult" | "youth";
  capacity: string;
  closes: string;
  window_start: string;
  window_end: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  category: "workshop",
  short_description: "",
  description: "",
  starts: "",
  ends: "",
  format: "in_person",
  meeting_link: "",
  venue: "",
  city: "",
  host_name: "",
  host_email: "",
  audience_lane: "adult",
  capacity: "",
  closes: "",
  window_start: "",
  window_end: "",
};

const formFromDetail = (detail: AdminEventDetail): FormState => ({
  title: detail.title,
  category: detail.category,
  short_description: detail.short_description,
  description: detail.description ?? "",
  starts: gstInputValue(detail.starts_at),
  ends: gstInputValue(detail.ends_at),
  format: detail.format,
  meeting_link: detail.meeting_link ?? "",
  venue: detail.venue ?? "",
  city: detail.city ?? "",
  host_name: detail.host_name ?? "",
  host_email: detail.host_email ?? "",
  audience_lane: detail.audience_lane,
  capacity: detail.capacity === null ? "" : String(detail.capacity),
  closes: detail.registration_closes_at === null ? "" : gstInputValue(detail.registration_closes_at),
  window_start: detail.priority_window_start === null ? "" : gstInputValue(detail.priority_window_start),
  window_end: detail.priority_window_end === null ? "" : gstInputValue(detail.priority_window_end),
});

// Light client-side check so obvious slips get a plain sentence before the
// round trip; the server re-checks everything.
const checkForm = (form: FormState): string | null => {
  if (form.title.trim() === "") {
    return "The event needs a title.";
  }
  if (form.short_description.trim() === "") {
    return "The short description is required - it is what members see on the card.";
  }
  const starts = msFromGstInput(form.starts);
  const ends = msFromGstInput(form.ends);
  if (starts === null || ends === null) {
    return "Set both a start and an end time.";
  }
  if (ends <= starts) {
    return "The end time must be after the start time.";
  }
  if (form.capacity.trim() !== "") {
    const cap = Number(form.capacity);
    if (!Number.isInteger(cap) || cap < 1) {
      return "Capacity must be a whole number of at least 1, or left empty for no limit.";
    }
  }
  if (
    form.format === "online" &&
    form.meeting_link.trim() !== "" &&
    !form.meeting_link.trim().startsWith("https://")
  ) {
    return "The meeting link must start with https://.";
  }
  const hostEmail = form.host_email.trim();
  if (hostEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hostEmail)) {
    return "The host email does not look like an email address.";
  }
  if (form.closes.trim() !== "") {
    const closes = msFromGstInput(form.closes);
    if (closes !== null && closes > starts) {
      return "Registration should close before the event starts.";
    }
  }
  const winStart = form.window_start.trim();
  const winEnd = form.window_end.trim();
  if ((winStart === "") !== (winEnd === "")) {
    return "The priority window needs both a start and an end, or neither.";
  }
  if (winStart !== "" && winEnd !== "") {
    const ws = msFromGstInput(winStart);
    const we = msFromGstInput(winEnd);
    if (ws === null || we === null || we <= ws) {
      return "The priority window must end after it starts.";
    }
    if (we > starts) {
      return "The priority window should end before the event starts.";
    }
  }
  return null;
};

type ConfirmKind = "publish" | "cancel" | "postpone" | null;

export function EventEditor({
  eventId,
  go,
}: {
  eventId?: Id<"events">;
  go: Go;
}) {
  // After creating, the editor keeps working against the new id without a
  // view switch, so the saved message stays visible.
  const [savedId, setSavedId] = useState<Id<"events"> | null>(null);
  const effectiveId = eventId ?? savedId ?? undefined;
  const detail = useQuery(
    api.admin.events.getEventAdmin,
    effectiveId === undefined ? "skip" : { eventId: effectiveId },
  );

  const upsert = useMutation(api.admin.events.upsertEvent);
  const publish = useMutation(api.admin.events.publishEvent);
  const cancel = useMutation(api.admin.events.cancelEvent);
  const postpone = useMutation(api.admin.events.postponeEvent);
  const setLinks = useMutation(api.admin.events.setEventLinks);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loadedFor, setLoadedFor] = useState<Id<"events"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirming, setConfirming] = useState<ConfirmKind>(null);
  // Saving is propose-then-confirm like every other console write ("no
  // silent writes" - design sweep blocker, 2026-07-07): the Save button only
  // opens this modal; upsertEvent fires from its confirm alone.
  const [saveConfirm, setSaveConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [newStarts, setNewStarts] = useState("");
  const [newEnds, setNewEnds] = useState("");
  const [postponeError, setPostponeError] = useState<string | null>(null);
  const [recording, setRecording] = useState("");
  const [materials, setMaterials] = useState("");
  const [linksOutcome, setLinksOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  // The Save button sits below the fold on this long form; without this a
  // failed save can produce no visible change in the viewport.
  const outcomeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (outcome !== null) {
      outcomeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [outcome]);

  // Initialise the form once the detail arrives (and again if the id changes).
  if (
    detail !== undefined &&
    detail !== null &&
    effectiveId !== undefined &&
    loadedFor !== effectiveId
  ) {
    setForm(formFromDetail(detail));
    setRecording(detail.recording_url ?? "");
    setMaterials(detail.materials_url ?? "");
    setLoadedFor(effectiveId);
  }

  const state: EventState | null = detail === undefined || detail === null ? null : detail.state;
  const isClosed = state === "cancelled" || state === "attendance_finalized";
  // Live = members can see it. Time changes on a live event must go through
  // Postpone (which notifies every booking holder), never a silent save.
  const isLive = state === "published" || state === "postponed";
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Propose step: validate first so she never confirms a doomed save, then
  // open the confirm modal. The mutation itself runs from onSave below,
  // called only by the modal's confirm button.
  const proposeSave = () => {
    const problem = checkForm(form);
    if (problem !== null) {
      setOutcome({ ok: false, message: problem });
      return;
    }
    setOutcome(null);
    setSaveConfirm(true);
  };

  const onSave = async () => {
    const problem = checkForm(form);
    if (problem !== null) {
      setOutcome({ ok: false, message: problem });
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      const starts_at = msFromGstInput(form.starts) as number;
      const ends_at = msFromGstInput(form.ends) as number;
      const res = await upsert({
        eventId: effectiveId,
        title: form.title.trim(),
        category: form.category,
        short_description: form.short_description.trim(),
        description: orUndef(form.description),
        starts_at,
        ends_at,
        format: form.format,
        meeting_link: form.format === "online" ? orUndef(form.meeting_link) : undefined,
        venue: form.format === "in_person" ? orUndef(form.venue) : undefined,
        city: form.format === "in_person" ? orUndef(form.city) : undefined,
        host_name: orUndef(form.host_name),
        host_email: orUndef(form.host_email),
        audience_lane: form.audience_lane,
        capacity: form.capacity.trim() === "" ? undefined : Number(form.capacity),
        registration_closes_at:
          form.closes.trim() === "" ? undefined : (msFromGstInput(form.closes) ?? undefined),
        priority_window_start:
          form.window_start.trim() === ""
            ? undefined
            : (msFromGstInput(form.window_start) ?? undefined),
        priority_window_end:
          form.window_end.trim() === ""
            ? undefined
            : (msFromGstInput(form.window_end) ?? undefined),
      });
      if (res.ok) {
        if (effectiveId === undefined) {
          setSavedId(res.eventId);
          // The form already holds exactly what was saved; skip the re-seed
          // when the detail query lands so keystrokes are never reverted.
          setLoadedFor(res.eventId);
          setOutcome({
            ok: true,
            message: "Saved. This event is a draft until you publish it.",
          });
        } else {
          setOutcome({ ok: true, message: "Changes saved." });
        }
      } else {
        setOutcome({
          ok: false,
          message:
            res.error === "invalid_state"
              ? "This event is closed history and can no longer be edited."
              : res.error === "lane_locked"
                ? "The audience cannot change once the event is live - members booked under it. Cancel this event and create a new one for the other audience."
                : res.error === "validation"
                  ? "Some details could not be saved. Check the times, capacity, links, the host email and text lengths."
                  : "That did not go through. Please try again.",
        });
      }
    } catch {
      setOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const runStateChange = async (kind: Exclude<ConfirmKind, null>) => {
    if (effectiveId === undefined) {
      return;
    }
    // Validate the new times before anything else so a slip keeps the modal
    // open with the correction instruction inside it, not behind it.
    if (kind === "postpone") {
      const ns = msFromGstInput(newStarts);
      const ne = msFromGstInput(newEnds);
      if (ns === null || ne === null || ne <= ns) {
        setPostponeError("Set a new start and end, with the end after the start.");
        return;
      }
    }
    setBusy(true);
    try {
      if (kind === "publish") {
        const res = await publish({ eventId: effectiveId });
        setOutcome(
          res.ok
            ? {
                ok: true,
                message: res.already === true
                  ? "Already published."
                  : "Published. Members can see and book it now.",
              }
            : {
                ok: false,
                message:
                  res.error === "invalid_state"
                    ? "Only a draft can be published."
                    : "That did not go through. Please try again.",
              },
        );
      } else if (kind === "cancel") {
        const res = await cancel({ eventId: effectiveId, reason: cancelReason.trim() });
        setOutcome(
          res.ok
            ? {
                ok: true,
                message: `Cancelled. ${res.notified} ${res.notified === 1 ? "member (registered or on the waiting list) was" : "members (registered or on the waiting list) were"} told, with your reason.`,
              }
            : {
                ok: false,
                message:
                  res.error === "validation"
                    ? "A reason is required, up to 300 characters. Members see it."
                    : res.error === "invalid_state"
                      ? "Only a published or postponed event can be cancelled."
                      : "That did not go through. Please try again.",
              },
        );
      } else {
        const ns = msFromGstInput(newStarts) as number;
        const ne = msFromGstInput(newEnds) as number;
        const res = await postpone({ eventId: effectiveId, newStartsAt: ns, newEndsAt: ne });
        if (res.ok) {
          // Resync the form times with the move: the form is seeded once per
          // id, and a later "Save changes" submits the FULL field set - stale
          // inputs would silently revert the new schedule (verification
          // blocker, 2026-07-07).
          setForm((f) => ({ ...f, starts: newStarts, ends: newEnds }));
        }
        setOutcome(
          res.ok
            ? {
                ok: true,
                message: `Moved. ${res.notified} ${res.notified === 1 ? "member (registered or on the waiting list) was" : "members (registered or on the waiting list) were"} told the new date; bookings stand.`,
              }
            : {
                ok: false,
                message:
                  res.error === "invalid_state"
                    ? "Only a published or postponed event can be moved."
                    : res.error === "validation"
                      ? "The new end time must be after the new start time."
                      : "That did not go through. Please try again.",
              },
        );
      }
    } catch {
      setOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
      setConfirming(null);
      setCancelReason("");
    }
  };

  const onSaveLinks = async () => {
    if (effectiveId === undefined) {
      return;
    }
    const isHttps = (url: string) => url.startsWith("https://");
    const rec = recording.trim();
    const mat = materials.trim();
    if (rec === "" && mat === "") {
      setLinksOutcome({ ok: false, message: "Add at least one link first." });
      return;
    }
    if ((rec !== "" && !isHttps(rec)) || (mat !== "" && !isHttps(mat))) {
      setLinksOutcome({ ok: false, message: "Links must start with https://." });
      return;
    }
    setBusy(true);
    setLinksOutcome(null);
    try {
      const res = await setLinks({
        eventId: effectiveId,
        recording_url: rec === "" ? undefined : rec,
        materials_url: mat === "" ? undefined : mat,
      });
      setLinksOutcome(
        res.ok
          ? {
              ok: true,
              message: "Saved. Members who registered can see these links.",
            }
          : {
              ok: false,
              message:
                res.error === "invalid_state"
                  ? "Links can only be added once the event is published."
                  : "The links were refused. They must be https and not too long.",
            },
      );
    } catch {
      setLinksOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  if (effectiveId !== undefined && detail === undefined) {
    return <p className="pn-meta">Loading…</p>;
  }
  if (effectiveId !== undefined && detail === null) {
    return <p className="pn-meta">This event no longer exists.</p>;
  }

  return (
    <>
      <nav className="pn-crumbs" aria-label="Breadcrumb">
        <button type="button" className="pn-crumb" onClick={() => go("events")}>
          Events
        </button>
        <span className="sep">›</span>
        <span aria-current="page">
          {effectiveId === undefined ? "New event" : form.title || "Event"}
        </span>
      </nav>
      <PageHeader
        eyebrow="Events"
        title={effectiveId === undefined ? "New event" : form.title || "Event"}
        sub={
          effectiveId === undefined
            ? "It starts as a draft. Members only see it once you publish."
            : detail !== undefined && detail !== null
              ? `${EVENT_STATE_WORDS[detail.state]} · ${fmtGstDateTime(detail.starts_at)}`
              : undefined
        }
      />

      {outcome !== null ? (
        <p ref={outcomeRef} role="status" className={outcome.ok ? "pn-ok" : "pn-error"}>
          {outcome.message}
        </p>
      ) : null}

      <div className="pn-cols">
        <div className="main">
          <PanelCard title="Basics">
            <label className="pn-label">
              Title
              <input
                className="pn-input"
                value={form.title}
                maxLength={200}
                disabled={isClosed}
                onChange={(e) => set("title", e.target.value)}
              />
            </label>
            <label className="pn-label">
              Category
              <select
                className="pn-input"
                value={form.category}
                disabled={isClosed}
                onChange={(e) => set("category", e.target.value as EventCategory)}
              >
                {CATEGORY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {EVENT_CATEGORY_WORDS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="pn-label">
              Short description ({form.short_description.length} / 500, shown on the event card)
              <textarea
                className="pn-input pn-textarea"
                value={form.short_description}
                maxLength={500}
                disabled={isClosed}
                onChange={(e) => set("short_description", e.target.value)}
              />
            </label>
            <label className="pn-label">
              Full description (optional)
              <textarea
                className="pn-input pn-textarea"
                value={form.description}
                disabled={isClosed}
                onChange={(e) => set("description", e.target.value)}
              />
            </label>
            <div className="pn-frow">
              <label className="pn-label">
                Starts (GST, Gulf time)
                <input
                  type="datetime-local"
                  className="pn-input"
                  value={form.starts}
                  disabled={isClosed || isLive}
                  onChange={(e) => set("starts", e.target.value)}
                />
              </label>
              <label className="pn-label">
                Ends (GST, Gulf time)
                <input
                  type="datetime-local"
                  className="pn-input"
                  value={form.ends}
                  disabled={isClosed || isLive}
                  onChange={(e) => set("ends", e.target.value)}
                />
              </label>
            </div>
            {isLive ? (
              <p className="pn-hint">
                To change the date or time of a live event, use Postpone below -
                it tells everyone holding a booking. Editing here would move the
                event silently.
              </p>
            ) : null}
            <fieldset className="pn-fieldset">
              <legend className="pn-label">Format</legend>
              <label className="pn-check">
                <input
                  type="radio"
                  name="format"
                  checked={form.format === "in_person"}
                  disabled={isClosed}
                  onChange={() => set("format", "in_person")}
                />
                <span>In person</span>
              </label>
              <label className="pn-check">
                <input
                  type="radio"
                  name="format"
                  checked={form.format === "online"}
                  disabled={isClosed}
                  onChange={() => set("format", "online")}
                />
                <span>Online</span>
              </label>
            </fieldset>
            {form.format === "in_person" ? (
              <div className="pn-frow">
                <label className="pn-label">
                  Venue
                  <input
                    className="pn-input"
                    value={form.venue}
                    disabled={isClosed}
                    onChange={(e) => set("venue", e.target.value)}
                  />
                </label>
                <label className="pn-label">
                  City
                  <input
                    className="pn-input"
                    value={form.city}
                    disabled={isClosed}
                    onChange={(e) => set("city", e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <label className="pn-label">
                Meeting link (shared with registered members only)
                <input
                  className="pn-input"
                  value={form.meeting_link}
                  disabled={isClosed}
                  onChange={(e) => set("meeting_link", e.target.value)}
                  placeholder="https://…"
                />
              </label>
            )}
            <div className="pn-frow">
              <label className="pn-label">
                Host name (optional)
                <input
                  className="pn-input"
                  value={form.host_name}
                  disabled={isClosed}
                  onChange={(e) => set("host_name", e.target.value)}
                />
              </label>
              <label className="pn-label">
                Host email (optional, never shown to members)
                <input
                  className="pn-input"
                  type="email"
                  value={form.host_email}
                  disabled={isClosed}
                  onChange={(e) => set("host_email", e.target.value)}
                />
              </label>
            </div>
            <fieldset className="pn-fieldset">
              <legend className="pn-label">Audience</legend>
              <label className="pn-check">
                <input
                  type="radio"
                  name="audience"
                  checked={form.audience_lane === "adult"}
                  disabled={isClosed || isLive}
                  onChange={() => set("audience_lane", "adult")}
                />
                <span>
                  <strong>Adults</strong>
                </span>
              </label>
              <label className="pn-check">
                <input
                  type="radio"
                  name="audience"
                  checked={form.audience_lane === "youth"}
                  disabled={isClosed || isLive}
                  onChange={() => set("audience_lane", "youth")}
                />
                <span>
                  <strong>Under 18</strong> - shown only to members under 18;
                  adults never see it, and adult sessions never appear to them.
                </span>
              </label>
              {isLive ? (
                <p className="pn-hint">
                  The audience is locked while the event is live - members
                  booked under it. For the other audience, cancel this event
                  and create a new one.
                </p>
              ) : null}
            </fieldset>
          </PanelCard>

          <PanelCard title="Registration">
            <div className="pn-frow">
              <label className="pn-label">
                Capacity (optional)
                <input
                  className="pn-input"
                  type="number"
                  min={1}
                  value={form.capacity}
                  disabled={isClosed}
                  onChange={(e) => set("capacity", e.target.value)}
                />
              </label>
              <label className="pn-label">
                Registration closes (optional, GST)
                <input
                  type="datetime-local"
                  className="pn-input"
                  value={form.closes}
                  disabled={isClosed}
                  onChange={(e) => set("closes", e.target.value)}
                />
              </label>
            </div>
            <p className="pn-hint">
              Leave capacity empty for no seat limit. When the seats fill,
              members join a waiting list automatically and are promoted in
              order when a seat frees up. Leave the closing time empty and
              members can register right up to the start.
            </p>
            <div className="pn-frow">
              <label className="pn-label">
                Priority window starts (optional, GST)
                <input
                  type="datetime-local"
                  className="pn-input"
                  value={form.window_start}
                  disabled={isClosed}
                  onChange={(e) => set("window_start", e.target.value)}
                />
              </label>
              <label className="pn-label">
                Priority window ends (optional, GST)
                <input
                  type="datetime-local"
                  className="pn-input"
                  value={form.window_end}
                  disabled={isClosed}
                  onChange={(e) => set("window_end", e.target.value)}
                />
              </label>
            </div>
            <p className="pn-hint">
              During the window only members at Active Member standing or above
              can take a seat. Active Member means a complete profile plus at
              least one action taken, like attending an event.
            </p>
            <div className="pn-btn-row">
              <button
                type="button"
                className="pn-btn"
                disabled={busy || isClosed}
                onClick={proposeSave}
              >
                {busy
                  ? "Working…"
                  : effectiveId === undefined
                    ? "Save as draft"
                    : "Save changes"}
              </button>
              {isClosed ? (
                <p className="pn-meta">
                  This event is closed history and can no longer be edited.
                </p>
              ) : null}
            </div>
          </PanelCard>
        </div>

        <div className="rail">
          {detail !== undefined && detail !== null ? (
            <>
              <PanelCard title="Status">
                <p className="pn-meta">
                  <span className={eventStateTagClass(detail.state)}>
                    {EVENT_STATE_WORDS[detail.state]}
                  </span>{" "}
                  {detail.state === "draft"
                    ? "Not visible to members yet."
                    : detail.state === "published"
                      ? "Live on the members' board."
                      : detail.state === "postponed"
                        ? "Moved to a new date; bookings stand."
                        : detail.state === "cancelled"
                          ? `Cancelled.${detail.cancelled_reason === null ? "" : ` Reason shared with members: ${detail.cancelled_reason}`}`
                          : "Closed. Attendance is final."}
                </p>
                <div className="pn-btn-row">
                  {detail.state === "draft" ? (
                    <button
                      type="button"
                      className="pn-btn pn-btn--sm"
                      disabled={busy}
                      onClick={() => setConfirming("publish")}
                    >
                      Publish
                    </button>
                  ) : null}
                  {detail.state === "published" || detail.state === "postponed" ? (
                    <>
                      <button
                        type="button"
                        className="pn-btn pn-btn--ghost pn-btn--sm"
                        disabled={busy}
                        onClick={() => {
                          // Seed with the current schedule so a one-hour slip
                          // is one field, and stale values never leak through.
                          setNewStarts(gstInputValue(detail.starts_at));
                          setNewEnds(gstInputValue(detail.ends_at));
                          setPostponeError(null);
                          setConfirming("postpone");
                        }}
                      >
                        Postpone
                      </button>
                      <button
                        type="button"
                        className="pn-btn pn-btn--ghost pn-btn--sm"
                        disabled={busy}
                        onClick={() => setConfirming("cancel")}
                      >
                        Cancel event
                      </button>
                    </>
                  ) : null}
                </div>
              </PanelCard>

              <PanelCard title="Registrations">
                <p className="pn-meta">
                  {detail.counts.registered} registered ·{" "}
                  {detail.counts.waitlisted} on the waiting list ·{" "}
                  {detail.counts.attended} attended
                </p>
                <button
                  type="button"
                  className="pn-btn pn-btn--ghost pn-btn--sm"
                  onClick={() => go("eventRegs", detail.eventId)}
                >
                  Registrations and check-in
                </button>
              </PanelCard>

              {detail.state !== "draft" && detail.state !== "cancelled" ? (
                <PanelCard title="After the event">
                  <label className="pn-label">
                    Recording link (https, members who registered only)
                    <input
                      className="pn-input"
                      value={recording}
                      onChange={(e) => setRecording(e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                  <label className="pn-label">
                    Materials link (https, members who registered only)
                    <input
                      className="pn-input"
                      value={materials}
                      onChange={(e) => setMaterials(e.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                  <div className="pn-btn-row">
                    <button
                      type="button"
                      className="pn-btn pn-btn--ghost pn-btn--sm"
                      disabled={busy}
                      onClick={() => void onSaveLinks()}
                    >
                      Save links
                    </button>
                  </div>
                  {linksOutcome !== null ? (
                    <p role="status" className={linksOutcome.ok ? "pn-ok" : "pn-error"}>
                      {linksOutcome.message}
                    </p>
                  ) : null}
                </PanelCard>
              ) : null}
            </>
          ) : (
            <PanelCard title="Status">
              <p className="pn-meta">
                Save the event first. It starts as a draft, invisible to
                members, and publishing is a separate confirmed step.
              </p>
            </PanelCard>
          )}
        </div>
      </div>

      {saveConfirm ? (
        <Modal
          title={
            effectiveId === undefined
              ? "Save this event as a draft?"
              : "Save these changes?"
          }
          sub={
            isLive
              ? `${form.title.trim()} is live - members see the new details the moment you confirm.`
              : effectiveId === undefined
                ? "It stays a draft, invisible to members, until you publish it."
                : "It is not published, so members see nothing yet."
          }
          onClose={() => setSaveConfirm(false)}
          onConfirm={() => {
            setSaveConfirm(false);
            void onSave();
          }}
          confirmLabel="Yes, save it"
          footNote="Recorded in the audit log."
        />
      ) : null}

      {confirming === "publish" && detail !== undefined && detail !== null ? (
        <Modal
          title="Publish this event"
          sub={`${detail.title} · ${fmtGstDateTime(detail.starts_at)}`}
          onClose={() => setConfirming(null)}
          onConfirm={() => void runStateChange("publish")}
          confirmLabel={busy ? "Working…" : "Yes, publish it"}
          confirmDisabled={busy}
          footNote="Members can see and book it the moment you confirm. Recorded in the audit log."
        />
      ) : null}

      {confirming === "cancel" && detail !== undefined && detail !== null ? (
        <Modal
          title="Cancel this event"
          sub={`${detail.title} · ${detail.counts.registered} registered, ${detail.counts.waitlisted} on the waiting list`}
          onClose={() => {
            setConfirming(null);
            setCancelReason("");
          }}
          onConfirm={() => void runStateChange("cancel")}
          confirmLabel={busy ? "Working…" : "Yes, cancel it"}
          cancelLabel="Keep it"
          confirmDisabled={busy || cancelReason.trim() === ""}
          footNote="Recorded in the audit log. Everyone registered or on the waiting list is told, with your reason."
        >
          <label className="pn-label">
            Reason ({cancelReason.length} / 300, members see this)
            <textarea
              className="pn-input pn-textarea"
              value={cancelReason}
              maxLength={300}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </label>
        </Modal>
      ) : null}

      {confirming === "postpone" && detail !== undefined && detail !== null ? (
        <Modal
          title="Move this event"
          sub={`${detail.title} · currently ${fmtGstDateTime(detail.starts_at)}`}
          onClose={() => setConfirming(null)}
          onConfirm={() => void runStateChange("postpone")}
          confirmLabel={busy ? "Working…" : "Yes, move it"}
          confirmDisabled={
            busy || newStarts.trim() === "" || newEnds.trim() === ""
          }
          footNote="Bookings stand. Everyone registered or on the waiting list is told the new date. Recorded in the audit log."
        >
          {postponeError !== null ? (
            <p className="pn-error">{postponeError}</p>
          ) : null}
          <label className="pn-label">
            New start (GST, Gulf time)
            <input
              type="datetime-local"
              className="pn-input"
              value={newStarts}
              onChange={(e) => {
                setNewStarts(e.target.value);
                setPostponeError(null);
              }}
            />
          </label>
          <label className="pn-label">
            New end (GST, Gulf time)
            <input
              type="datetime-local"
              className="pn-input"
              value={newEnds}
              onChange={(e) => {
                setNewEnds(e.target.value);
                setPostponeError(null);
              }}
            />
          </label>
        </Modal>
      ) : null}
    </>
  );
}
