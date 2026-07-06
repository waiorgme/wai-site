import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PartnerDetail as PartnerRecord } from "../../../convex/admin/partners";
import { Modal, PageHeader, PanelCard } from "../../panel/kit";
import type { DeliverableStatus, Go, PartnerStatus, PartnerTier } from "./shared";
import {
  DELIVERABLE_WORDS,
  PARTNER_STATUS_WORDS,
  partnerStatusTagClass,
  TIER_EXPLAIN,
  TIER_WORDS,
  orUndef,
} from "./shared";

// Partner create/edit (panel-experience spec G16). The form is the single
// writer for the relationship record and the deliverables LIST; each
// deliverable's status change on a saved row goes through the dedicated
// audited action (before/after in the log). Seal grant/withdraw and the logo
// upload are their own audited steps, mirroring the profile photo pattern.

type Deliverable = { label: string; status: DeliverableStatus };

type FormState = {
  name: string;
  tier: PartnerTier;
  status: PartnerStatus;
  contact_name: string;
  contact_email: string;
  website: string;
  mou_signed_on: string;
  term_months: string;
  committed_value: string;
  deliverables: Deliverable[];
  show_publicly: boolean;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  tier: "supporter",
  status: "prospect",
  contact_name: "",
  contact_email: "",
  website: "",
  mou_signed_on: "",
  term_months: "12",
  committed_value: "",
  deliverables: [],
  show_publicly: false,
  notes: "",
};

const formFromDetail = (detail: PartnerRecord): FormState => ({
  name: detail.name,
  tier: detail.tier,
  status: detail.status,
  contact_name: detail.contact_name ?? "",
  contact_email: detail.contact_email ?? "",
  website: detail.website ?? "",
  mou_signed_on: detail.mou_signed_on ?? "",
  term_months: String(detail.term_months),
  committed_value: detail.committed_value ?? "",
  deliverables: detail.deliverables.map((d) => ({ ...d })),
  show_publicly: detail.show_publicly,
  notes: detail.notes ?? "",
});

const STATUS_KEYS = Object.keys(PARTNER_STATUS_WORDS) as PartnerStatus[];
const TIER_KEYS = Object.keys(TIER_WORDS) as PartnerTier[];
const DELIVERABLE_KEYS = Object.keys(DELIVERABLE_WORDS) as DeliverableStatus[];

export function PartnerDetail({
  partnerId,
  go,
}: {
  partnerId?: Id<"partners">;
  go: Go;
}) {
  const [savedId, setSavedId] = useState<Id<"partners"> | null>(null);
  const effectiveId = partnerId ?? savedId ?? undefined;
  const detail = useQuery(
    api.admin.partners.getPartner,
    effectiveId === undefined ? "skip" : { partnerId: effectiveId },
  );

  const upsert = useMutation(api.admin.partners.upsertPartner);
  const setSeal = useMutation(api.admin.partners.setSeal);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loadedFor, setLoadedFor] = useState<Id<"partners"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [sealConfirm, setSealConfirm] = useState<"granted" | "withdrawn" | null>(null);
  // Propose-then-confirm on the record save itself (Gate 4, 2026-07-07): the
  // vault guardrail is confirmation before EVERY change, and a single-click
  // save also commits staged deliverable edits.
  const [saveConfirm, setSaveConfirm] = useState(false);

  if (
    detail !== undefined &&
    detail !== null &&
    effectiveId !== undefined &&
    loadedFor !== effectiveId
  ) {
    setForm(formFromDetail(detail));
    setLoadedFor(effectiveId);
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setDeliverable = (index: number, next: Deliverable) =>
    setForm((f) => ({
      ...f,
      deliverables: f.deliverables.map((d, i) => (i === index ? next : d)),
    }));

  const onSave = async () => {
    if (form.name.trim() === "") {
      setOutcome({ ok: false, message: "The partner needs a name." });
      return;
    }
    const term = Number(form.term_months);
    if (!Number.isInteger(term) || term < 1 || term > 120) {
      setOutcome({
        ok: false,
        message: "The term is in whole months, between 1 and 120.",
      });
      return;
    }
    if (form.deliverables.some((d) => d.label.trim() === "")) {
      setOutcome({
        ok: false,
        message: "Every deliverable needs a label, or remove the empty row.",
      });
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      const res = await upsert({
        partnerId: effectiveId,
        name: form.name.trim(),
        tier: form.tier,
        status: form.status,
        contact_name: orUndef(form.contact_name),
        contact_email: orUndef(form.contact_email),
        website: orUndef(form.website),
        mou_signed_on: orUndef(form.mou_signed_on),
        term_months: term,
        committed_value: orUndef(form.committed_value),
        deliverables: form.deliverables.map((d) => ({
          label: d.label.trim(),
          status: d.status,
        })),
        show_publicly: form.show_publicly,
        notes: orUndef(form.notes),
      });
      if (res.ok) {
        if (effectiveId === undefined) {
          setSavedId(res.partnerId);
          setOutcome({ ok: true, message: "Partner record created." });
        } else {
          setOutcome({ ok: true, message: "Changes saved." });
        }
      } else {
        setOutcome({
          ok: false,
          message:
            res.error === "validation"
              ? "Some details were refused by the server. Check the name, email and term."
              : "That did not go through. Please try again.",
        });
      }
    } catch {
      setOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const onSetSeal = async () => {
    if (effectiveId === undefined || sealConfirm === null) {
      return;
    }
    setBusy(true);
    try {
      const res = await setSeal({ partnerId: effectiveId, seal: sealConfirm });
      setOutcome(
        res.ok
          ? {
              ok: true,
              message:
                sealConfirm === "granted"
                  ? "Seal granted. Recorded in the audit log."
                  : "Seal withdrawn. Recorded in the audit log.",
            }
          : { ok: false, message: "That did not go through. Please try again." },
      );
    } catch {
      setOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
      setSealConfirm(null);
    }
  };

  if (effectiveId !== undefined && detail === undefined) {
    return <p className="pn-meta">Loading…</p>;
  }
  if (effectiveId !== undefined && detail === null) {
    return <p className="pn-meta">This partner record no longer exists.</p>;
  }

  return (
    <>
      <nav className="pn-crumbs" aria-label="Breadcrumb">
        <button type="button" className="pn-crumb" onClick={() => go("partners")}>
          Partners
        </button>
        <span className="sep">›</span>
        <span aria-current="page">
          {effectiveId === undefined ? "New partner" : form.name || "Partner"}
        </span>
      </nav>
      <PageHeader
        eyebrow="Partners"
        title={effectiveId === undefined ? "New partner" : form.name || "Partner"}
        sub={
          detail !== undefined && detail !== null ? (
            <>
              <span className={partnerStatusTagClass(detail.status)}>
                {PARTNER_STATUS_WORDS[detail.status]}
              </span>{" "}
              {TIER_WORDS[detail.tier]} · {TIER_EXPLAIN[detail.tier]}
            </>
          ) : (
            "A relationship record: the MOU outcome, what was committed, and what has been delivered."
          )
        }
      />

      {outcome !== null ? (
        <p role="status" className={outcome.ok ? "pn-ok" : "pn-error"}>
          {outcome.message}
        </p>
      ) : null}

      <div className="pn-cols">
        <div className="main">
          <PanelCard title="The relationship">
            <label className="pn-label">
              Company name
              <input
                className="pn-input"
                value={form.name}
                maxLength={160}
                onChange={(e) => set("name", e.target.value)}
              />
            </label>
            <div className="pn-frow">
              <label className="pn-label">
                Tier (the MOU outcome)
                <select
                  className="pn-input"
                  value={form.tier}
                  onChange={(e) => set("tier", e.target.value as PartnerTier)}
                >
                  {TIER_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {TIER_WORDS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pn-label">
                Status
                <select
                  className="pn-input"
                  value={form.status}
                  onChange={(e) => set("status", e.target.value as PartnerStatus)}
                >
                  {STATUS_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {PARTNER_STATUS_WORDS[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="pn-hint">{TIER_EXPLAIN[form.tier]}</p>
            <div className="pn-frow">
              <label className="pn-label">
                Contact name (optional)
                <input
                  className="pn-input"
                  value={form.contact_name}
                  onChange={(e) => set("contact_name", e.target.value)}
                />
              </label>
              <label className="pn-label">
                Contact email (optional)
                <input
                  className="pn-input"
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => set("contact_email", e.target.value)}
                />
              </label>
            </div>
            <div className="pn-frow">
              <label className="pn-label">
                Website (optional)
                <input
                  className="pn-input"
                  value={form.website}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="https://…"
                />
              </label>
              <label className="pn-label">
                MOU signed on (optional)
                <input
                  className="pn-input"
                  type="date"
                  value={form.mou_signed_on}
                  onChange={(e) => set("mou_signed_on", e.target.value)}
                />
              </label>
            </div>
            <div className="pn-frow">
              <label className="pn-label">
                Term (months)
                <input
                  className="pn-input"
                  type="number"
                  min={1}
                  max={120}
                  value={form.term_months}
                  onChange={(e) => set("term_months", e.target.value)}
                />
              </label>
              <label className="pn-label">
                Committed value (in words, never invoices)
                <input
                  className="pn-input"
                  value={form.committed_value}
                  onChange={(e) => set("committed_value", e.target.value)}
                  placeholder="e.g. two scholarship seats and a venue for one workshop"
                />
              </label>
            </div>
            <label className="pn-check">
              <input
                type="checkbox"
                checked={form.show_publicly}
                onChange={(e) => set("show_publicly", e.target.checked)}
              />
              <span>
                Ready to be shown publicly. Actually putting partners on the
                public site is a separate decision - this switch only records
                readiness.
              </span>
            </label>
            <label className="pn-label">
              Internal notes (optional, never shown outside this console)
              <textarea
                className="pn-input pn-textarea"
                value={form.notes}
                maxLength={2000}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
          </PanelCard>

          <PanelCard
            title="Deliverables"
            count={`· ${form.deliverables.length}`}
            actions={
              <button
                type="button"
                className="pn-btn pn-btn--ghost pn-btn--sm"
                onClick={() =>
                  set("deliverables", [
                    ...form.deliverables,
                    { label: "", status: "committed" },
                  ])
                }
              >
                Add deliverable
              </button>
            }
          >
            <p className="pn-meta">
              Committed versus delivered is the honest ledger: impact counts
              only what was actually delivered.
            </p>
            {form.deliverables.length === 0 ? (
              <p className="pn-meta">Nothing committed yet.</p>
            ) : (
              form.deliverables.map((deliverable, index) => (
                <DeliverableRow
                  key={index}
                  index={index}
                  deliverable={deliverable}
                  detail={detail ?? null}
                  partnerId={effectiveId}
                  onChange={(next) => setDeliverable(index, next)}
                  onRemove={() =>
                    set(
                      "deliverables",
                      form.deliverables.filter((_, i) => i !== index),
                    )
                  }
                  onOutcome={setOutcome}
                />
              ))
            )}
            <div className="pn-btn-row">
              <button
                type="button"
                className="pn-btn"
                disabled={busy}
                onClick={() => setSaveConfirm(true)}
              >
                {busy
                  ? "Working…"
                  : effectiveId === undefined
                    ? "Create partner record"
                    : "Save changes"}
              </button>
            </div>
            {saveConfirm && (
              <Modal
                title={
                  effectiveId === undefined
                    ? "Create this partner record?"
                    : "Save these changes?"
                }
                sub={`${form.name.trim() || "Unnamed partner"} · ${TIER_WORDS[form.tier]} · ${form.deliverables.length} deliverable${form.deliverables.length === 1 ? "" : "s"}`}
                onClose={() => setSaveConfirm(false)}
                onConfirm={() => {
                  setSaveConfirm(false);
                  void onSave();
                }}
                confirmLabel={
                  effectiveId === undefined ? "Yes, create it" : "Yes, save it"
                }
                footNote="This change is recorded."
              >
                <p className="pn-meta">
                  This writes the whole record: relationship details, MOU
                  facts, and every deliverable row as it stands above.
                </p>
              </Modal>
            )}
          </PanelCard>
        </div>

        <div className="rail">
          {detail !== undefined && detail !== null && effectiveId !== undefined ? (
            <>
              <PanelCard title="The seal">
                <p className="pn-meta">
                  {detail.seal === "granted"
                    ? "Seal granted. It marks a signed partner in good faith; withdrawing it is reputational, never enforcement."
                    : detail.seal === "withdrawn"
                      ? "Seal withdrawn. That is on the record; it can be granted again if trust is restored."
                      : "No seal yet. It is granted on signing and can be withdrawn for bad faith. Reputational only, never enforcement."}
                </p>
                <div className="pn-btn-row">
                  {detail.seal !== "granted" ? (
                    <button
                      type="button"
                      className="pn-btn pn-btn--ghost pn-btn--sm"
                      disabled={busy}
                      onClick={() => setSealConfirm("granted")}
                    >
                      Grant the seal
                    </button>
                  ) : null}
                  {detail.seal === "granted" ? (
                    <button
                      type="button"
                      className="pn-btn pn-btn--ghost pn-btn--sm"
                      disabled={busy}
                      onClick={() => setSealConfirm("withdrawn")}
                    >
                      Withdraw the seal
                    </button>
                  ) : null}
                </div>
              </PanelCard>
              <LogoPanel partnerId={effectiveId} logoUrl={detail.logo_url} />
            </>
          ) : (
            <PanelCard title="Seal and logo">
              <p className="pn-meta">
                Create the record first. The seal and the logo live on the
                saved record, each as its own recorded step.
              </p>
            </PanelCard>
          )}
        </div>
      </div>

      {sealConfirm !== null && detail !== undefined && detail !== null ? (
        <Modal
          title={sealConfirm === "granted" ? "Grant the seal" : "Withdraw the seal"}
          sub={detail.name}
          onClose={() => setSealConfirm(null)}
          onConfirm={() => void onSetSeal()}
          confirmLabel={
            busy
              ? "Working…"
              : sealConfirm === "granted"
                ? "Yes, grant it"
                : "Yes, withdraw it"
          }
          confirmDisabled={busy}
          footNote="Recorded in the audit log. The consequence is reputational only, never enforcement."
        >
          <p className="pn-meta">
            {sealConfirm === "granted"
              ? "The seal says this company signed and is backing the community in good faith."
              : "Withdrawing says the commitment was not honoured. The record of granting and withdrawing stays."}
          </p>
        </Modal>
      ) : null}
    </>
  );
}

/* ---------- one deliverable row ---------- */

// A saved row (matching the server's array by index and label) changes status
// through the dedicated audited action, with an inline confirm. A new or
// re-labelled row just edits the form; Save writes it with the record.
function DeliverableRow({
  index,
  deliverable,
  detail,
  partnerId,
  onChange,
  onRemove,
  onOutcome,
}: {
  index: number;
  deliverable: Deliverable;
  detail: PartnerRecord | null;
  partnerId: Id<"partners"> | undefined;
  onChange: (next: Deliverable) => void;
  onRemove: () => void;
  onOutcome: (outcome: { ok: boolean; message: string }) => void;
}) {
  const setStatus = useMutation(api.admin.partners.setDeliverableStatus);
  const [pending, setPending] = useState<DeliverableStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const serverRow =
    detail !== null && index < detail.deliverables.length
      ? detail.deliverables[index]
      : null;
  const isSavedRow =
    partnerId !== undefined &&
    serverRow !== null &&
    serverRow.label === deliverable.label;

  const confirmStatus = async () => {
    if (partnerId === undefined || pending === null) {
      return;
    }
    setBusy(true);
    try {
      const res = await setStatus({ partnerId, index, status: pending });
      if (res.ok) {
        onChange({ ...deliverable, status: pending });
        onOutcome({
          ok: true,
          message: `"${deliverable.label}" is now ${DELIVERABLE_WORDS[pending].toLowerCase()}. Recorded in the audit log.`,
        });
      } else {
        onOutcome({
          ok: false,
          message: "That status change did not go through. Save the record and try again.",
        });
      }
    } catch {
      onOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div className="pn-stack">
      <div className="pn-delrow">
        <input
          className="pn-input"
          value={deliverable.label}
          maxLength={160}
          aria-label={`Deliverable ${index + 1}`}
          placeholder="e.g. Two scholarship seats"
          onChange={(e) => onChange({ ...deliverable, label: e.target.value })}
        />
        <select
          className="pn-input"
          value={pending ?? deliverable.status}
          aria-label={`Status of deliverable ${index + 1}`}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value as DeliverableStatus;
            if (isSavedRow) {
              setPending(next === deliverable.status ? null : next);
            } else {
              onChange({ ...deliverable, status: next });
            }
          }}
        >
          {DELIVERABLE_KEYS.map((key) => (
            <option key={key} value={key}>
              {DELIVERABLE_WORDS[key]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="pn-link"
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
      {pending !== null && isSavedRow ? (
        <div className="pn-propose">
          <p className="pn-meta">
            Mark "{deliverable.label}" as{" "}
            {DELIVERABLE_WORDS[pending].toLowerCase()}? The change is recorded
            in the audit log.
          </p>
          <div className="pn-confirm-row">
            <button
              type="button"
              className="pn-btn pn-btn--sm"
              disabled={busy}
              onClick={() => void confirmStatus()}
            >
              {busy ? "Working…" : "Yes, record it"}
            </button>
            <button
              type="button"
              className="pn-link"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- logo upload (mirrors the profile photo pattern) ---------- */

function LogoPanel({
  partnerId,
  logoUrl,
}: {
  partnerId: Id<"partners">;
  logoUrl: string | null;
}) {
  const generateUploadUrl = useMutation(api.admin.partners.generateLogoUploadUrl);
  const setLogo = useMutation(api.admin.partners.setPartnerLogo);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const onPick = async (file: File) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) {
      setMessage({
        ok: false,
        text: "Please choose a JPG, PNG or WebP image under 5 MB.",
      });
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const urlRes = await generateUploadUrl();
      if (!urlRes.ok) {
        setMessage({ ok: false, text: "That did not go through. Please try again." });
        return;
      }
      const res = await fetch(urlRes.url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const linked = await setLogo({ partnerId, storageId });
      setMessage(
        linked.ok
          ? { ok: true, text: "Logo saved. Recorded in the audit log." }
          : {
              ok: false,
              text: "The image was refused. JPG, PNG or WebP under 5 MB.",
            },
      );
    } catch {
      setMessage({ ok: false, text: "That upload failed. Please try again." });
    } finally {
      setUploading(false);
    }
  };

  return (
    <PanelCard title="Logo">
      {logoUrl !== null ? (
        <img src={logoUrl} alt="Current partner logo" className="pn-logo-preview" />
      ) : (
        <p className="pn-meta">No logo yet.</p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) {
            void onPick(file);
          }
          e.target.value = "";
        }}
      />
      <div className="pn-btn-row">
        <button
          type="button"
          className="pn-btn pn-btn--ghost pn-btn--sm"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Uploading…" : logoUrl !== null ? "Replace logo" : "Add a logo"}
        </button>
      </div>
      {message !== null ? (
        <p role="status" className={message.ok ? "pn-ok" : "pn-error"}>
          {message.text}
        </p>
      ) : null}
    </PanelCard>
  );
}
