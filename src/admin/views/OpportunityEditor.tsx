import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AdminApplicationRow,
  AdminOpportunityDetail,
} from "../../../convex/admin/opportunities";
import type { Column } from "../../panel/kit";
import {
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  PanelCard,
} from "../../panel/kit";
import type { Go, OpportunityType } from "./shared";
import {
  APP_STATE_WORDS,
  appStateTagClass,
  fmtGstDate,
  fmtGstDeadline,
  gstInputValue,
  msFromGstInput,
  OPP_STATE_WORDS,
  OPP_TYPE_EXPLAIN,
  OPP_TYPE_WORDS,
  oppStateTagClass,
  orUndef,
  plural,
} from "./shared";

// Opportunity create/edit + applications (panel-experience spec B7). The type
// select drives the shape: evergreen listings carry a claim path and take no
// applications; the other two carry a deadline and a what-to-submit note.
// Shortlist, record-result and decide are all propose-then-confirm; decide is
// blocked until every application has an answer (the server enforces it too).

type FormState = {
  title: string;
  partner_name: string;
  type: OpportunityType;
  description: string;
  what_to_submit: string;
  eligibility_note: string;
  how_to_claim: string;
  audience: "women_only" | "open";
  deadline: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  partner_name: "",
  type: "competitive",
  description: "",
  what_to_submit: "",
  eligibility_note: "",
  how_to_claim: "",
  audience: "women_only",
  deadline: "",
};

const formFromDetail = (detail: AdminOpportunityDetail): FormState => ({
  title: detail.title,
  partner_name: detail.partner_name ?? "",
  type: detail.type,
  description: detail.description,
  what_to_submit: detail.what_to_submit ?? "",
  eligibility_note: detail.eligibility_note ?? "",
  how_to_claim: detail.how_to_claim ?? "",
  audience: detail.audience,
  deadline: detail.deadline === null ? "" : gstInputValue(detail.deadline),
});

const checkForm = (form: FormState, live: boolean): string | null => {
  if (form.title.trim() === "") {
    return "The listing needs a title.";
  }
  if (form.description.trim() === "") {
    return "The description is required - it is what members read.";
  }
  if (form.type === "evergreen") {
    if (form.how_to_claim.trim() === "") {
      return "An ongoing benefit needs a 'how to claim' path.";
    }
  } else {
    const deadlineMs = msFromGstInput(form.deadline);
    if (deadlineMs === null) {
      return "This type needs a closing deadline.";
    }
    // The cron auto-closes open listings past their deadline, so saving a
    // past deadline onto a live listing would silently kill it.
    if (live && deadlineMs <= Date.now()) {
      return "That deadline has already passed - it would close this live listing within the hour.";
    }
  }
  return null;
};

type ConfirmKind = "publish" | "close" | "decide" | null;

export function OpportunityEditor({
  id,
  go,
}: {
  id?: Id<"opportunities">;
  go: Go;
}) {
  const [savedId, setSavedId] = useState<Id<"opportunities"> | null>(null);
  const effectiveId = id ?? savedId ?? undefined;
  const detail = useQuery(
    api.admin.opportunities.getOpportunityAdmin,
    effectiveId === undefined ? "skip" : { id: effectiveId },
  );
  const applications = useQuery(
    api.admin.opportunities.listApplications,
    effectiveId === undefined ? "skip" : { opportunityId: effectiveId },
  );

  const upsert = useMutation(api.admin.opportunities.upsertOpportunity);
  const publish = useMutation(api.admin.opportunities.publishOpportunity);
  const close = useMutation(api.admin.opportunities.closeOpportunity);
  const decide = useMutation(api.admin.opportunities.decideOpportunity);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loadedFor, setLoadedFor] = useState<Id<"opportunities"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirming, setConfirming] = useState<ConfirmKind>(null);
  // Saving is propose-then-confirm like every other console write ("no
  // silent writes"): Save only opens this modal; the mutation fires from
  // its confirm alone (design sweep blocker, 2026-07-07).
  const [saveConfirm, setSaveConfirm] = useState(false);
  const [closeReason, setCloseReason] = useState("");

  if (
    detail !== undefined &&
    detail !== null &&
    effectiveId !== undefined &&
    loadedFor !== effectiveId
  ) {
    setForm(formFromDetail(detail));
    setLoadedFor(effectiveId);
  }

  const isSettled =
    detail !== undefined &&
    detail !== null &&
    (detail.state === "closed" || detail.state === "decided");
  const isLive = detail !== undefined && detail !== null && detail.state === "open";
  const typeLocked = isLive;
  // Unsaved edits matter at publish time: "Open it" publishes the SAVED
  // record, so the publish modal warns when the form differs from it.
  const dirty =
    detail !== undefined &&
    detail !== null &&
    JSON.stringify(form) !== JSON.stringify(formFromDetail(detail));
  const unresolved =
    applications === undefined
      ? 0
      : applications.filter(
          (a) => a.state === "received" || a.state === "shortlisted",
        ).length;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Propose step: validate first so she never confirms a doomed save.
  const proposeSave = () => {
    const problem = checkForm(form, isLive);
    if (problem !== null) {
      setOutcome({ ok: false, message: problem });
      return;
    }
    setOutcome(null);
    setSaveConfirm(true);
  };

  const onSave = async () => {
    const problem = checkForm(form, isLive);
    if (problem !== null) {
      setOutcome({ ok: false, message: problem });
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      const res = await upsert({
        id: effectiveId,
        title: form.title.trim(),
        partner_name: orUndef(form.partner_name),
        type: form.type,
        description: form.description.trim(),
        what_to_submit:
          form.type === "evergreen" ? undefined : orUndef(form.what_to_submit),
        eligibility_note: orUndef(form.eligibility_note),
        how_to_claim:
          form.type === "evergreen" ? orUndef(form.how_to_claim) : undefined,
        audience: form.audience,
        deadline:
          form.type === "evergreen"
            ? undefined
            : (msFromGstInput(form.deadline) ?? undefined),
      });
      if (res.ok) {
        if (effectiveId === undefined) {
          setSavedId(res.id);
          setOutcome({
            ok: true,
            message: "Saved. This listing is a draft until you publish it.",
          });
        } else {
          setOutcome({ ok: true, message: "Changes saved." });
        }
      } else {
        setOutcome({
          ok: false,
          message:
            res.error === "closed"
              ? "A closed listing is a settled record. Corrections mean a new listing."
              : res.error === "validation"
                ? "Some details were refused by the server. Check the type, deadline and text lengths."
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
    setBusy(true);
    try {
      if (kind === "publish") {
        const res = await publish({ id: effectiveId });
        setOutcome(
          res.ok
            ? {
                ok: true,
                message: res.already === true
                  ? "Already open."
                  : "Open. Eligible members can see it now.",
              }
            : {
                ok: false,
                message:
                  res.error === "validation"
                    ? // The server validates the SAVED record, so the hint
                      // keys off detail.type, not the possibly-unsaved select.
                      detail?.type === "evergreen"
                      ? "It needs a 'how to claim' path before it can open."
                      : "Set a deadline in the future before opening it."
                    : "Only a draft can be opened.",
              },
        );
      } else if (kind === "close") {
        const res = await close({
          id: effectiveId,
          reason: orUndef(closeReason),
        });
        setOutcome(
          res.ok
            ? {
                ok: true,
                message: res.already === true
                  ? "Already closed."
                  : detail?.type === "evergreen"
                    ? "Closed. It is no longer shown to members."
                    : "Closed. Members can no longer apply. Next: record a result for every application, then publish the results.",
              }
            : {
                ok: false,
                message: "Only an open listing can be closed.",
              },
        );
      } else {
        const res = await decide({ opportunityId: effectiveId });
        setOutcome(
          res.ok
            ? {
                ok: true,
                message: res.already === true
                  ? "Results were already published."
                  : "Results published. The cycle is finished and every applicant has an answer.",
              }
            : {
                ok: false,
                message:
                  res.error === "unresolved_applications"
                    ? "Not yet - some applications still have no result. Everyone gets an answer first."
                    : res.error === "not_closed"
                      ? "Close the listing before publishing results."
                      : res.error === "evergreen"
                        ? "An ongoing benefit has no results to publish."
                        : "That did not go through. Please try again.",
              },
        );
      }
    } catch {
      setOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
      setConfirming(null);
      setCloseReason("");
    }
  };

  // After a first save the form already holds the data, so skip the
  // loading unmount (savedId set) rather than flash "Loading…" mid-save.
  if (effectiveId !== undefined && detail === undefined && savedId === null) {
    return <p className="pn-meta">Loading…</p>;
  }
  if (effectiveId !== undefined && detail === null) {
    return <p className="pn-meta">This listing no longer exists.</p>;
  }

  return (
    <>
      <nav className="pn-crumbs" aria-label="Breadcrumb">
        <button
          type="button"
          className="pn-crumb"
          onClick={() => go("opportunities")}
        >
          Opportunities
        </button>
        <span className="sep">›</span>
        <span aria-current="page">
          {effectiveId === undefined ? "New opportunity" : form.title || "Listing"}
        </span>
      </nav>
      <PageHeader
        eyebrow="Opportunities"
        title={effectiveId === undefined ? "New opportunity" : form.title || "Listing"}
        sub={
          effectiveId === undefined
            ? "It starts as a draft. Members only see it once you open it."
            : detail !== undefined && detail !== null
              ? `${OPP_STATE_WORDS[detail.state]} · ${OPP_TYPE_WORDS[detail.type]}${detail.deadline !== null ? ` · ${isSettled ? "closed" : "closes"} ${fmtGstDeadline(detail.deadline)}` : ""}`
              : undefined
        }
      />

      {outcome !== null ? (
        <p role="status" className={outcome.ok ? "pn-ok" : "pn-error"}>
          {outcome.message}
        </p>
      ) : null}

      <div className="pn-cols">
        <div className="main">
          <PanelCard title="The listing">
            <label className="pn-label">
              Title
              <input
                className="pn-input"
                value={form.title}
                maxLength={200}
                disabled={isSettled}
                onChange={(e) => set("title", e.target.value)}
              />
            </label>
            <label className="pn-label">
              Partner (optional, shown to members)
              <input
                className="pn-input"
                value={form.partner_name}
                maxLength={200}
                disabled={isSettled}
                onChange={(e) => set("partner_name", e.target.value)}
              />
            </label>
            <label className="pn-label">
              Type
              <select
                className="pn-input"
                value={form.type}
                disabled={isSettled || typeLocked}
                onChange={(e) => set("type", e.target.value as OpportunityType)}
              >
                {(Object.keys(OPP_TYPE_WORDS) as OpportunityType[]).map((key) => (
                  <option key={key} value={key}>
                    {OPP_TYPE_WORDS[key]}
                  </option>
                ))}
              </select>
            </label>
            <p className="pn-hint">
              {OPP_TYPE_EXPLAIN[form.type]}
              {typeLocked
                ? " The type is fixed while the listing is open, so live applications are never stranded."
                : ""}
            </p>
            <label className="pn-label">
              Description
              <textarea
                className="pn-input pn-textarea"
                value={form.description}
                maxLength={5000}
                disabled={isSettled}
                onChange={(e) => set("description", e.target.value)}
              />
            </label>
            {form.type === "evergreen" ? (
              <label className="pn-label">
                How to claim (members follow this path any time)
                <textarea
                  className="pn-input pn-textarea"
                  value={form.how_to_claim}
                  maxLength={5000}
                  disabled={isSettled}
                  onChange={(e) => set("how_to_claim", e.target.value)}
                />
              </label>
            ) : (
              <>
                <label className="pn-label">
                  Deadline (GST, Gulf time; the board shows it as a closing date)
                  <input
                    type="datetime-local"
                    className="pn-input"
                    value={form.deadline}
                    disabled={isSettled}
                    onChange={(e) => set("deadline", e.target.value)}
                  />
                </label>
                <p className="pn-hint">
                  The convention is 11:59 PM GST on the closing day. Open
                  listings close on their own once the deadline passes.
                </p>
                <label className="pn-label">
                  What to submit (optional)
                  <textarea
                    className="pn-input pn-textarea"
                    value={form.what_to_submit}
                    maxLength={5000}
                    disabled={isSettled}
                    onChange={(e) => set("what_to_submit", e.target.value)}
                  />
                </label>
              </>
            )}
            <label className="pn-label">
              Eligibility note (optional, shown in plain words)
              <textarea
                className="pn-input pn-textarea"
                value={form.eligibility_note}
                maxLength={5000}
                disabled={isSettled}
                onChange={(e) => set("eligibility_note", e.target.value)}
              />
            </label>
            <fieldset className="pn-fieldset">
              <legend className="pn-label">Audience</legend>
              <label className="pn-check">
                <input
                  type="radio"
                  name="opp-audience"
                  checked={form.audience === "women_only"}
                  disabled={isSettled}
                  onChange={() => set("audience", "women_only")}
                />
                <span>
                  <strong>Women only</strong> (the default) - allies never see
                  it.
                </span>
              </label>
              <label className="pn-check">
                <input
                  type="radio"
                  name="opp-audience"
                  checked={form.audience === "open"}
                  disabled={isSettled}
                  onChange={() => set("audience", "open")}
                />
                <span>
                  <strong>Open</strong> - every active adult member sees it,
                  allies included. Members under 18 never see opportunities
                  either way.
                </span>
              </label>
            </fieldset>
            <div className="pn-btn-row">
              <button
                type="button"
                className="pn-btn"
                disabled={busy || isSettled}
                onClick={proposeSave}
              >
                {busy
                  ? "Working…"
                  : effectiveId === undefined
                    ? "Save as draft"
                    : "Save changes"}
              </button>
              {isSettled ? (
                <p className="pn-meta">
                  A closed listing is a settled record. Corrections mean a new
                  listing.
                </p>
              ) : null}
            </div>
          </PanelCard>

          {detail !== undefined && detail !== null && detail.type !== "evergreen" ? (
            <ApplicationsPanel
              applications={applications}
              settled={detail.state === "decided"}
            />
          ) : null}
        </div>

        <div className="rail">
          {detail !== undefined && detail !== null ? (
            <PanelCard title="Status">
              <p className="pn-meta">
                <span className={oppStateTagClass(detail.state)}>
                  {OPP_STATE_WORDS[detail.state]}
                </span>{" "}
                {detail.state === "draft"
                  ? "Not visible to members yet."
                  : detail.state === "open"
                    ? "Live on the members' board."
                    : detail.state === "closed"
                      ? detail.type === "evergreen"
                        ? "No longer shown to members. An ongoing benefit stays closed."
                        : "No longer taking applications. Record every result, then publish them."
                      : "Finished. Every applicant has an answer."}
              </p>
              <div className="pn-btn-row">
                {detail.state === "draft" ? (
                  <button
                    type="button"
                    className="pn-btn pn-btn--sm"
                    disabled={busy}
                    onClick={() => setConfirming("publish")}
                  >
                    Open it
                  </button>
                ) : null}
                {detail.state === "open" ? (
                  <button
                    type="button"
                    className="pn-btn pn-btn--ghost pn-btn--sm"
                    disabled={busy}
                    onClick={() => setConfirming("close")}
                  >
                    Close early
                  </button>
                ) : null}
                {detail.state === "closed" && detail.type !== "evergreen" ? (
                  <button
                    type="button"
                    className="pn-btn pn-btn--sm"
                    disabled={busy || unresolved > 0}
                    onClick={() => setConfirming("decide")}
                  >
                    Publish the results
                  </button>
                ) : null}
              </div>
              {detail.state === "closed" && unresolved > 0 ? (
                <p className="pn-meta">
                  Record a result for every application first -{" "}
                  {plural(unresolved, "is", "are")} still waiting. Everyone
                  gets an answer before a cycle is declared finished.
                </p>
              ) : null}
            </PanelCard>
          ) : (
            <PanelCard title="Status">
              <p className="pn-meta">
                Save the listing first. It starts as a draft, and opening it is
                a separate confirmed step.
              </p>
            </PanelCard>
          )}
        </div>
      </div>

      {saveConfirm ? (
        <Modal
          title={
            effectiveId === undefined
              ? "Save this listing as a draft?"
              : "Save these changes?"
          }
          sub={
            detail !== undefined && detail !== null && detail.state === "open"
              ? `${form.title.trim()} is open - eligible members see the new details the moment you confirm.`
              : effectiveId === undefined
                ? "It stays a draft, invisible to members, until you publish it."
                : "It is not open, so members see nothing yet."
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
          title="Open this opportunity"
          sub={detail.title}
          onClose={() => setConfirming(null)}
          onConfirm={() => void runStateChange("publish")}
          confirmLabel={busy ? "Working…" : "Yes, open it"}
          confirmDisabled={busy}
          footNote="Eligible members can see and apply the moment you confirm. Recorded in the audit log."
        >
          {dirty ? (
            <p className="pn-meta">
              You have unsaved edits - what goes live is the last saved
              version. Save first to include them.
            </p>
          ) : null}
        </Modal>
      ) : null}

      {confirming === "close" && detail !== undefined && detail !== null ? (
        <Modal
          title="Close this opportunity early"
          sub={
            detail.type === "evergreen"
              ? detail.title
              : `${detail.title} · ${detail.application_counts.active} live ${detail.application_counts.active === 1 ? "application" : "applications"}`
          }
          onClose={() => {
            setConfirming(null);
            setCloseReason("");
          }}
          onConfirm={() => void runStateChange("close")}
          confirmLabel={busy ? "Working…" : "Yes, close it"}
          confirmDisabled={busy}
          footNote="Recorded in the audit log. Applications already in stay in; members can no longer apply."
        >
          <label className="pn-label">
            Reason (optional, goes in the audit log)
            <textarea
              className="pn-input pn-textarea"
              value={closeReason}
              maxLength={200}
              onChange={(e) => setCloseReason(e.target.value)}
            />
          </label>
        </Modal>
      ) : null}

      {confirming === "decide" && detail !== undefined && detail !== null ? (
        <Modal
          title="Publish the results"
          sub={detail.title}
          onClose={() => setConfirming(null)}
          onConfirm={() => void runStateChange("decide")}
          confirmLabel={busy ? "Working…" : "Yes, publish them"}
          confirmDisabled={busy}
          footNote="This declares the cycle finished. Recorded in the audit log."
        >
          <p className="pn-meta">
            Every application has a recorded result, and every applicant has
            already been told hers. This step closes the book on the cycle.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

/* ---------- applications ---------- */

const APP_COLUMNS: ReadonlyArray<Column> = [
  { key: "who", header: "Applicant" },
  { key: "state", header: "State", width: "130px" },
  { key: "received", header: "Received", width: "110px" },
  { key: "actions", header: "Actions", width: "320px" },
];

function ApplicationsPanel({
  applications,
  settled,
}: {
  applications: AdminApplicationRow[] | undefined;
  settled: boolean;
}) {
  const renderCell = (row: AdminApplicationRow, col: Column) => {
    switch (col.key) {
      case "who":
        return (
          <div className="pn-cell-2l">
            <span className="t">{row.applicant_name}</span>
            <span className="s">
              {row.standing === "active_member"
                ? "Active Member - takes part and profile complete"
                : row.standing === "member"
                  ? "Member"
                  : row.standing === "ambassador"
                    ? "Ambassador"
                    : "Leadership Circle"}
            </span>
            {row.statement !== null && row.statement.trim() !== "" ? (
              <details>
                <summary className="pn-link">Read her statement</summary>
                <span className="s" style={{ whiteSpace: "pre-wrap" }}>
                  {row.statement}
                </span>
              </details>
            ) : null}
          </div>
        );
      case "state":
        return (
          <span className={appStateTagClass(row.state)}>
            {APP_STATE_WORDS[row.state]}
          </span>
        );
      case "received":
        return <span className="pn-cell-date">{fmtGstDate(row.created_at)}</span>;
      case "actions":
        if (settled) {
          return <span className="pn-meta">Cycle finished</span>;
        }
        return <ApplicationActions row={row} />;
      default:
        return null;
    }
  };

  return (
    <PanelCard
      title="Applications"
      count={
        applications === undefined ? undefined : `· ${applications.length}`
      }
      tight
    >
      {applications === undefined ? (
        <p className="pn-meta pn-loading">Loading…</p>
      ) : (
        <DataTable
          columns={APP_COLUMNS}
          rows={applications}
          rowKey={(row) => row.applicationId}
          renderCell={renderCell}
          empty={
            <EmptyState
              eyebrow="Applications"
              message="No applications yet. They appear here the moment a member applies."
            />
          }
        />
      )}
    </PanelCard>
  );
}

// Shortlist (both directions) with an inline confirm; record-result at modal
// grade with the required won/lost choice and an optional kind note.
function ApplicationActions({ row }: { row: AdminApplicationRow }) {
  const setShortlisted = useMutation(api.admin.opportunities.setShortlisted);
  const recordResult = useMutation(api.admin.opportunities.recordResult);

  const [proposingShortlist, setProposingShortlist] = useState(false);
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<"won" | "lost" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (row.state === "withdrawn") {
    return <span className="pn-meta">She withdrew</span>;
  }
  if (row.state === "won" || row.state === "lost") {
    return (
      <span className="pn-meta">
        Result recorded - she has been told
        {message !== null ? (
          <span role="status" className={message.ok ? "pn-ok" : "pn-error"}>
            {" "}
            {message.text}
          </span>
        ) : null}
      </span>
    );
  }

  const toggleTo = row.state === "received";

  const confirmShortlist = async () => {
    setBusy(true);
    try {
      const res = await setShortlisted({
        applicationId: row.applicationId,
        on: toggleTo,
      });
      setMessage(
        res.ok
          ? {
              ok: true,
              text: toggleTo ? "Shortlisted." : "Back to received.",
            }
          : {
              ok: false,
              text:
                res.error === "conflict"
                  ? "This application moved on already."
                  : "That did not go through. Please try again.",
            },
      );
    } catch {
      setMessage({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
      setProposingShortlist(false);
    }
  };

  const confirmResult = async () => {
    if (result === null) {
      return;
    }
    setBusy(true);
    try {
      const res = await recordResult({
        applicationId: row.applicationId,
        result,
        note: orUndef(note),
      });
      setMessage(
        res.ok
          ? {
              ok: true,
              text:
                result === "won"
                  ? "Recorded. She has been told the good news."
                  : "Recorded. She has been told, kindly.",
            }
          : {
              ok: false,
              text:
                res.error === "conflict"
                  ? "This application already has a result or was withdrawn."
                  : res.error === "winner_exists"
                    ? "This listing already has its winner - a single-winner opportunity takes exactly one. To change the winner, start a new listing."
                    : "That did not go through. Please try again.",
            },
      );
    } catch {
      setMessage({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
      setRecording(false);
      setResult(null);
      setNote("");
    }
  };

  return (
    <div className="pn-btn-row">
      {proposingShortlist ? (
        <>
          <span className="pn-meta">
            {toggleTo
              ? "Shortlist her? She is not told - this only marks her for your decision. Recorded in the audit log."
              : "Take her off the shortlist? She is not told."}
          </span>
          <button
            type="button"
            className="pn-btn pn-btn--sm"
            disabled={busy}
            onClick={() => void confirmShortlist()}
          >
            {busy ? "Working…" : "Yes"}
          </button>
          <button
            type="button"
            className="pn-link"
            disabled={busy}
            onClick={() => setProposingShortlist(false)}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="pn-link"
            onClick={() => setProposingShortlist(true)}
          >
            {toggleTo ? "Shortlist" : "Remove shortlist"}
          </button>
          <button
            type="button"
            className="pn-link"
            onClick={() => setRecording(true)}
          >
            Record result
          </button>
        </>
      )}
      {message !== null ? (
        <span role="status" className={message.ok ? "pn-ok" : "pn-error"}>
          {message.text}
        </span>
      ) : null}
      {recording ? (
        <Modal
          title="Record her result"
          sub={row.applicant_name}
          onClose={() => {
            setRecording(false);
            setResult(null);
            setNote("");
          }}
          onConfirm={() => void confirmResult()}
          confirmLabel={busy ? "Working…" : "Yes, record it"}
          confirmDisabled={busy || result === null}
          footNote="She is told the moment you confirm - win or lose, everyone gets an answer. Recorded in the audit log."
        >
          <label className="pn-check">
            <input
              type="radio"
              name={`result-${row.applicationId}`}
              checked={result === "won"}
              onChange={() => setResult("won")}
            />
            <span>
              <strong>Won</strong> - she is selected and gets the congratulations
              note.
            </span>
          </label>
          <label className="pn-check">
            <input
              type="radio"
              name={`result-${row.applicationId}`}
              checked={result === "lost"}
              onChange={() => setResult("lost")}
            />
            <span>
              <strong>Not selected</strong> - she gets a kind answer, and her
              profile stays in the running for what comes next.
            </span>
          </label>
          <label className="pn-label">
            Note (optional - she sees this with her result)
            <textarea
              className="pn-input pn-textarea"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}
