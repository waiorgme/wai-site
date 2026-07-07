import { useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MemberDossier } from "../../../convex/admin/members";
import { EmptyState, Modal, PageHeader, PanelCard, ProgressBar, Tabs } from "../../panel/kit";
import { CertificateRowActions } from "./CertificateActions";
import type { Go, Lifecycle, Standing } from "./shared";
import {
  dateStringLabel,
  fmtGstDate,
  fmtGstDateTime,
  LANE_EXPLAIN,
  LANE_WORDS,
  LIFECYCLE_EXPLAIN,
  LIFECYCLE_WORDS,
  lifecycleTagClass,
  plainAction,
  STANDING_EXPLAIN,
  STANDING_WORDS,
} from "./shared";

// One member's dossier (panel-experience spec F14). Contact is masked by the
// server; the raw values only arrive through the audited one-at-a-time reveal
// below (the claim-queue precedent). Status changes offer ONLY the legal
// transitions for her current state, require a reason, and land in the audit
// log. Erasure never happens here - it stays in the data-requests queue.

// Mirror of the server's ADMIN_STATUS_TRANSITIONS (the server re-checks).
const TRANSITIONS: Partial<
  Record<Lifecycle, ReadonlyArray<"active" | "dormant" | "suspended">>
> = {
  active: ["dormant", "suspended"],
  dormant: ["active", "suspended"],
  suspended: ["active"],
};

const TRANSITION_EXPLAIN: Record<"active" | "dormant" | "suspended", string> = {
  active: "Restores full member access and counts her as active again.",
  dormant:
    "Pauses the membership. Her record is kept but she is not counted as active.",
  suspended: "Puts access on hold after an upheld conduct report.",
};

type TabKey = "overview" | "profile" | "engagement" | "certificates" | "notes";

export function MemberDetail({
  memberId,
  go,
}: {
  memberId: Id<"members">;
  go: Go;
}) {
  const dossier = useQuery(api.admin.members.getMemberAdmin, { memberId });
  const [tab, setTab] = useState<TabKey>("overview");
  const [changingStatus, setChangingStatus] = useState(false);
  const [statusOutcome, setStatusOutcome] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  if (dossier === undefined) {
    return <p className="pn-meta">Loading…</p>;
  }
  if (dossier === null) {
    return (
      <EmptyState
        eyebrow="Members"
        message="This record no longer exists."
        action={
          <button
            type="button"
            className="pn-btn pn-btn--ghost pn-btn--sm"
            onClick={() => go("members")}
          >
            Back to members
          </button>
        }
      />
    );
  }

  const legalMoves = TRANSITIONS[dossier.lifecycle_state] ?? [];

  return (
    <>
      <nav className="pn-crumbs" aria-label="Breadcrumb">
        <button type="button" className="pn-crumb" onClick={() => go("members")}>
          Members
        </button>
        <span className="sep">›</span>
        <span aria-current="page">{dossier.name}</span>
      </nav>

      <PageHeader
        eyebrow={`${LIFECYCLE_WORDS[dossier.lifecycle_state]} · member since ${dateStringLabel(dossier.joined)}`}
        title={dossier.name}
        sub={
          dossier.membership_number !== null
            ? `WAIME-MEM-${dossier.membership_number} · shown to members as WAIME-${dossier.membership_number} · ${dossier.source === "migrated" ? "moved across from the old list" : "joined through the site"}`
            : dossier.source === "migrated"
              ? "moved across from the old list"
              : "joined through the site"
        }
        actions={
          legalMoves.length > 0 ? (
            <button
              type="button"
              className="pn-btn pn-btn--ghost pn-btn--sm"
              onClick={() => {
                setStatusOutcome(null);
                setChangingStatus(true);
              }}
            >
              Change status
            </button>
          ) : undefined
        }
      />

      {statusOutcome !== null ? (
        <p role="status" className={statusOutcome.ok ? "pn-ok" : "pn-error"}>
          {statusOutcome.message}
        </p>
      ) : null}
      {legalMoves.length === 0 ? (
        <p className="pn-meta">
          Status changes here cover active, dormant and suspended. This record
          is {LIFECYCLE_WORDS[dossier.lifecycle_state].toLowerCase()}.{" "}
          {LIFECYCLE_EXPLAIN[dossier.lifecycle_state]}
        </p>
      ) : null}

      <Tabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "profile", label: "Profile" },
          {
            key: "engagement",
            label: "Engagement",
            count: dossier.registrations.length + dossier.applications.length,
          },
          {
            key: "certificates",
            label: "Certificates",
            count: dossier.certificates.length,
          },
          { key: "notes", label: "Notes", count: dossier.notes.length },
        ]}
        active={tab}
        onSelect={(key) => setTab(key as TabKey)}
        label="Member record views"
      />

      {tab === "overview" ? <OverviewTab dossier={dossier} /> : null}
      {tab === "profile" ? <ProfileTab dossier={dossier} /> : null}
      {tab === "engagement" ? <EngagementTab dossier={dossier} /> : null}
      {tab === "certificates" ? <CertificatesTab dossier={dossier} /> : null}
      {tab === "notes" ? <NotesTab dossier={dossier} /> : null}

      {changingStatus ? (
        <StatusChangeModal
          dossier={dossier}
          moves={legalMoves}
          onClose={() => setChangingStatus(false)}
          onOutcome={(outcome) => {
            setStatusOutcome(outcome);
            setChangingStatus(false);
          }}
        />
      ) : null}
    </>
  );
}

/* ---------- status change (modal-grade propose-then-confirm) ---------- */

function StatusChangeModal({
  dossier,
  moves,
  onClose,
  onOutcome,
}: {
  dossier: MemberDossier;
  moves: ReadonlyArray<"active" | "dormant" | "suspended">;
  onClose: () => void;
  onOutcome: (outcome: { ok: boolean; message: string }) => void;
}) {
  const changeStatus = useMutation(api.admin.members.changeMemberStatus);
  const [to, setTo] = useState<"active" | "dormant" | "suspended" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (to === null) {
      return;
    }
    setBusy(true);
    try {
      const res = await changeStatus({
        memberId: dossier.memberId,
        to,
        reason: reason.trim(),
      });
      if (res.ok) {
        onOutcome({
          ok: true,
          message: `Done. She is now ${LIFECYCLE_WORDS[res.lifecycle_state].toLowerCase()}. Recorded in the audit log.`,
        });
      } else {
        onOutcome({
          ok: false,
          message:
            res.error === "validation"
              ? "A reason is required."
              : res.error === "invalid_transition"
                ? "That change is not allowed from her current status."
                : "That did not go through. Please try again.",
        });
      }
    } catch {
      onOutcome({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Change her status"
      sub={`${dossier.name} · currently ${LIFECYCLE_WORDS[dossier.lifecycle_state].toLowerCase()}`}
      onClose={onClose}
      onConfirm={() => void submit()}
      confirmLabel={busy ? "Working…" : "Yes, change it"}
      confirmDisabled={busy || to === null || reason.trim() === ""}
      footNote="Recorded in the audit log with your reason. She is not sent an email about this; her portal simply reflects the new status the next time she signs in. Erasure requests are handled in the data-requests queue, never here."
    >
      <p className="pn-meta">
        Only the moves allowed from her current status are listed.
      </p>
      {moves.map((move) => (
        <label key={move} className="pn-check">
          <input
            type="radio"
            name="new-status"
            checked={to === move}
            onChange={() => setTo(move)}
          />
          <span>
            <strong>{LIFECYCLE_WORDS[move]}</strong>
            <br />
            {TRANSITION_EXPLAIN[move]}
          </span>
        </label>
      ))}
      <label className="pn-label">
        Reason (required, goes in the audit log)
        <textarea
          className="pn-input pn-textarea"
          value={reason}
          maxLength={140}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Plain operational wording, e.g. 'asked to pause while abroad'"
        />
      </label>
      <p className="pn-hint">Up to 140 characters.</p>
    </Modal>
  );
}

/* ---------- overview tab ---------- */

function OverviewTab({ dossier }: { dossier: MemberDossier }) {
  const attended = dossier.registrations.filter(
    (r) => r.state === "attended",
  ).length;
  return (
    <div className="pn-cols">
      <div className="main">
        <PanelCard title="Status">
          <dl className="pn-dl">
            <dt>Membership</dt>
            <dd>
              <span className={lifecycleTagClass(dossier.lifecycle_state)}>
                {LIFECYCLE_WORDS[dossier.lifecycle_state]}
              </span>{" "}
              {LIFECYCLE_EXPLAIN[dossier.lifecycle_state]}
            </dd>
            <dt>Standing</dt>
            <dd>
              <strong>{STANDING_WORDS[dossier.standing]}</strong> ·{" "}
              {STANDING_EXPLAIN[dossier.standing]}
            </dd>
            <dt>Lane</dt>
            <dd>
              <strong>{LANE_WORDS[dossier.member_lane]}</strong> ·{" "}
              {LANE_EXPLAIN[dossier.member_lane]}
            </dd>
            {dossier.guardian !== null ? (
              <>
                <dt>Guardian</dt>
                <dd>{guardianLine(dossier.guardian)}</dd>
              </>
            ) : null}
          </dl>
        </PanelCard>

        <PanelCard title="Consents">
          <ConsentsList consents={dossier.consents} />
        </PanelCard>
      </div>

      <div className="rail">
        <ContactPanel dossier={dossier} />
        <PanelCard title="At a glance">
          <div className="pn-stats">
            <div className="pn-stat">
              <span className="k">Events attended</span>
              <span className="v">{attended}</span>
            </div>
            <div className="pn-stat">
              <span className="k">Applications</span>
              <span className="v">{dossier.applications.length}</span>
            </div>
            <div className="pn-stat">
              <span className="k">Certificates</span>
              <span className="v">{dossier.certificates.length}</span>
            </div>
          </div>
          <ProgressBar
            label="Profile completeness"
            value={dossier.completeness_pct}
            valueLabel={`${dossier.completeness_pct}%`}
          />
        </PanelCard>
      </div>
    </div>
  );
}

function guardianLine(guardian: NonNullable<MemberDossier["guardian"]>): string {
  const who =
    guardian.masked_guardian_name === null
      ? "a guardian"
      : `guardian ${guardian.masked_guardian_name}`;
  if (guardian.consent_state === "confirmed") {
    return `Confirmed by ${who}.`;
  }
  if (guardian.confirmation_state === "expired") {
    return `Waiting on ${who} - the confirmation link expired. The pending-guardians queue can resend it.`;
  }
  return `Waiting on ${who} to confirm. The pending-guardians queue tracks it.`;
}

const CONSENT_LABELS: Record<
  MemberDossier["consents"][number]["type"],
  { label: string; explain: string }
> = {
  terms_privacy: {
    label: "Terms and privacy",
    explain: "the membership terms and privacy policy",
  },
  marketing: {
    label: "Marketing emails",
    explain: "news and community emails beyond the essential ones",
  },
  pipeline: {
    label: "Talent pipeline",
    explain: "being considered when partners bring opportunities",
  },
};

function ConsentsList({
  consents,
}: {
  consents: MemberDossier["consents"];
}) {
  const types = ["terms_privacy", "marketing", "pipeline"] as const;
  return (
    <dl className="pn-dl">
      {types.map((type) => {
        const latest = consents.find((c) => c.type === type);
        return (
          <div key={type} style={{ display: "contents" }}>
            <dt>{CONSENT_LABELS[type].label}</dt>
            <dd>
              {latest === undefined ? (
                <>Never asked ({CONSENT_LABELS[type].explain}).</>
              ) : (
                <>
                  <strong>{latest.value ? "Yes" : "No"}</strong> to{" "}
                  {CONSENT_LABELS[type].explain} ·{" "}
                  {latest.source === "settings"
                    ? "changed in her settings"
                    : latest.source === "claim"
                      ? "given while claiming"
                      : "given at join"}{" "}
                  · {fmtGstDate(latest.timestamp)} · terms version{" "}
                  {latest.policy_version}
                </>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/* ---------- audited contact reveal (the claim-queue precedent) ---------- */

function ContactPanel({ dossier }: { dossier: MemberDossier }) {
  const reveal = useMutation(api.admin.members.revealMemberContact);
  const [phase, setPhase] = useState<"masked" | "proposing" | "busy">("masked");
  const [revealed, setRevealed] = useState<{
    email: string;
    mobile: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onReveal = async () => {
    setPhase("busy");
    setError(null);
    try {
      const res = await reveal({ memberId: dossier.memberId });
      if (res.ok) {
        setRevealed({ email: res.email, mobile: res.mobile });
      } else {
        setError("That did not go through. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPhase("masked");
    }
  };

  return (
    <PanelCard title="Contact">
      {revealed !== null ? (
        <div role="status" className="pn-stack">
          <dl className="pn-dl">
            <dt>Email</dt>
            <dd>{revealed.email}</dd>
            <dt>Mobile</dt>
            <dd>{revealed.mobile ?? "Not given"}</dd>
          </dl>
          <p className="pn-meta">
            This reveal is in the audit log. Details stay off this page next
            time you open it.
          </p>
        </div>
      ) : (
        <>
          <dl className="pn-dl">
            <dt>Email</dt>
            <dd className="pn-mono">{dossier.masked_email}</dd>
            <dt>Mobile</dt>
            <dd className="pn-mono">{dossier.masked_mobile ?? "Not given"}</dd>
          </dl>
          {phase === "masked" ? (
            <button
              type="button"
              className="pn-link"
              onClick={() => setPhase("proposing")}
            >
              Reveal contact
            </button>
          ) : (
            <div className="pn-propose">
              <p className="pn-meta">
                Reveal this member's email and mobile, one member at a time.
                The reveal itself is recorded in the audit log.
              </p>
              <div className="pn-confirm-row">
                <button
                  type="button"
                  className="pn-btn"
                  disabled={phase === "busy"}
                  onClick={() => void onReveal()}
                >
                  {phase === "busy" ? "Working…" : "Yes, reveal it"}
                </button>
                <button
                  type="button"
                  className="pn-link"
                  disabled={phase === "busy"}
                  onClick={() => setPhase("masked")}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {error !== null ? (
            <p role="status" className="pn-error">
              {error}
            </p>
          ) : null}
        </>
      )}
    </PanelCard>
  );
}

/* ---------- profile tab (read-only field groups) ---------- */

function Value({ children }: { children: string }) {
  return children.trim() === "" ? (
    <span className="pn-meta">Not provided</span>
  ) : (
    <>{children}</>
  );
}

function ListValue({ items }: { items: string[] }) {
  return items.length === 0 ? (
    <span className="pn-meta">Not provided</span>
  ) : (
    <>{items.join(", ")}</>
  );
}

function ProfileTab({ dossier }: { dossier: MemberDossier }) {
  const p = dossier.profile;
  return (
    <div className="pn-cols">
      <div className="main">
        <PanelCard title="About her">
          <dl className="pn-dl">
            <dt>Headline</dt>
            <dd>
              <Value>{p.identity.headline}</Value>
            </dd>
            <dt>Bio</dt>
            <dd>
              <Value>{p.identity.bio}</Value>
            </dd>
            <dt>Nationality</dt>
            <dd>
              <Value>{p.background.nationality}</Value>
            </dd>
            <dt>Country of residence</dt>
            <dd>
              <Value>{p.background.country_of_residence}</Value>
            </dd>
            <dt>Career stage</dt>
            <dd>
              <Value>{p.background.career_stage_answer}</Value>
            </dd>
          </dl>
        </PanelCard>
        <PanelCard title="Experience">
          <dl className="pn-dl">
            <dt>Function area</dt>
            <dd>
              <Value>{p.experience.function_area}</Value>
            </dd>
            <dt>Role</dt>
            <dd>
              <Value>{p.experience.role}</Value>
            </dd>
            <dt>Second area</dt>
            <dd>
              <Value>{p.experience.second_function_area}</Value>
            </dd>
            <dt>Second role</dt>
            <dd>
              <Value>{p.experience.second_role}</Value>
            </dd>
            <dt>Years in aviation</dt>
            <dd>
              <Value>{p.experience.years_in_aviation}</Value>
            </dd>
            <dt>Job title</dt>
            <dd>
              <Value>{p.experience.current_job_title}</Value>
            </dd>
            <dt>Employer</dt>
            <dd>
              <Value>{p.experience.current_employer}</Value>
            </dd>
            <dt>Sectors</dt>
            <dd>
              <ListValue items={p.experience.sectors} />
            </dd>
          </dl>
        </PanelCard>
      </div>
      <div className="rail">
        <PanelCard title="Qualifications">
          <dl className="pn-dl">
            <dt>Certifications</dt>
            <dd>
              <ListValue items={p.qualifications.certifications} />
            </dd>
            <dt>Other certifications</dt>
            <dd>
              <Value>{p.qualifications.certifications_other}</Value>
            </dd>
            <dt>Highest qualification</dt>
            <dd>
              <Value>{p.qualifications.highest_qualification}</Value>
            </dd>
            <dt>Field of study</dt>
            <dd>
              <Value>{p.qualifications.field_of_study}</Value>
            </dd>
            <dt>Institution</dt>
            <dd>
              <Value>{p.qualifications.institution}</Value>
            </dd>
          </dl>
        </PanelCard>
        <PanelCard title="Looking for">
          <p className="pn-meta">
            <ListValue items={p.looking_for} />
          </p>
        </PanelCard>
      </div>
    </div>
  );
}

/* ---------- engagement tab ---------- */

const REG_WORDS: Record<
  MemberDossier["registrations"][number]["state"],
  string
> = {
  registered: "Registered",
  waitlisted: "On the waitlist",
  cancelled: "Cancelled",
  attended: "Attended",
  no_show: "No show",
};

function EngagementTab({ dossier }: { dossier: MemberDossier }) {
  return (
    <div className="pn-cols">
      <div className="main">
        <PanelCard
          title="Event bookings"
          count={`· ${dossier.registrations.length}`}
        >
          {dossier.registrations.length === 0 ? (
            <EmptyState eyebrow="Events" message="No bookings yet." />
          ) : (
            <RowList
              rows={dossier.registrations.map((r) => ({
                key: r.registrationId,
                title: r.event_title,
                tag: REG_WORDS[r.state],
                when: r.starts_at === null ? "" : fmtGstDateTime(r.starts_at),
              }))}
            />
          )}
        </PanelCard>
        <PanelCard
          title="Applications"
          count={`· ${dossier.applications.length}`}
        >
          {dossier.applications.length === 0 ? (
            <EmptyState eyebrow="Opportunities" message="No applications yet." />
          ) : (
            <RowList
              rows={dossier.applications.map((a) => ({
                key: a.applicationId,
                title: a.opportunity_title,
                tag:
                  a.state === "won"
                    ? "Won"
                    : a.state === "lost"
                      ? "Not selected"
                      : a.state === "withdrawn"
                        ? "Withdrew"
                        : a.state === "shortlisted"
                          ? "Shortlisted"
                          : "Received",
                when: fmtGstDate(a.created_at),
              }))}
            />
          )}
        </PanelCard>
      </div>
      <div className="rail">
        <PanelCard title="Standing history">
          {dossier.standing_history.length === 0 ? (
            <p className="pn-meta">
              No standing changes recorded. Standing moves up on its own when
              her profile is complete and she takes part.
            </p>
          ) : (
            <div className="pn-log">
              {dossier.standing_history.map((h, i) => (
                <div key={i} className="pn-log-row">
                  <span className="pn-when">{fmtGstDate(h.timestamp)}</span>
                  <p className="pn-meta">
                    <strong>
                      {STANDING_WORDS[h.from_standing as Standing] ?? h.from_standing}{" "}
                      to {STANDING_WORDS[h.to_standing as Standing] ?? h.to_standing}
                    </strong>
                  </p>
                  <p className="pn-meta">{h.reason}</p>
                </div>
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard title="Recent record changes">
          {dossier.recent_audit.length === 0 ? (
            <p className="pn-meta">Nothing recorded for this member yet.</p>
          ) : (
            <div className="pn-log">
              {dossier.recent_audit.map((row, i) => (
                <div key={i} className="pn-log-row">
                  <span className="pn-when">{fmtGstDateTime(row.timestamp)}</span>
                  <p className="pn-meta">
                    <strong>{plainAction(row.action)}</strong> by {row.actor}
                  </p>
                  {row.after_summary ? (
                    <p className="pn-meta">{row.after_summary}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}

function RowList({
  rows,
}: {
  rows: Array<{ key: string; title: string; tag: string; when: string }>;
}) {
  return (
    <div className="pn-log">
      {rows.map((row) => (
        <div key={row.key} className="pn-log-row">
          {row.when !== "" ? <span className="pn-when">{row.when}</span> : null}
          <p className="pn-meta">
            <strong>{row.title}</strong> · {row.tag}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ---------- certificates tab ---------- */

function CertificatesTab({ dossier }: { dossier: MemberDossier }) {
  return (
    <PanelCard title="Certificates" count={`· ${dossier.certificates.length}`}>
      {dossier.certificates.length === 0 ? (
        <EmptyState
          eyebrow="Certificates"
          message="No certificate yet. One is issued when her membership becomes active."
        />
      ) : (
        dossier.certificates.map((cert) => (
          <div key={cert.certificateId} className="pn-row">
            <div className="pn-row-head">
              <span className="pn-mono">WAIME-MEM-{cert.membership_number}</span>
              <span
                className={
                  cert.status === "valid"
                    ? "pn-tag pn-tag--ok"
                    : cert.status === "revoked"
                      ? "pn-tag pn-tag--err"
                      : "pn-tag"
                }
              >
                {cert.status === "valid"
                  ? "Valid"
                  : cert.status === "revoked"
                    ? "Revoked"
                    : "Superseded"}
              </span>
              {cert.is_founding ? (
                <span className="pn-tag">Founding Member</span>
              ) : null}
            </div>
            <p className="pn-meta">Issued {cert.issued_date_label}</p>
            {cert.status === "superseded" ? (
              <p className="pn-meta">
                Superseded - replaced by a newer certificate on this record.
              </p>
            ) : null}
            {cert.status === "revoked" ? (
              <p className="pn-meta">
                Revoked - the reason is in the audit trail.
              </p>
            ) : null}
            <CertificateRowActions
              certificateId={cert.certificateId}
              status={cert.status}
              numberLabel={`WAIME-MEM-${cert.membership_number}`}
              recipientName={dossier.name}
            />
          </div>
        ))
      )}
    </PanelCard>
  );
}

/* ---------- notes tab ---------- */

function NotesTab({ dossier }: { dossier: MemberDossier }) {
  const addNote = useMutation(api.admin.members.addMemberNote);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReactNode | null>(null);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    setBusy(true);
    setOutcome(null);
    setFailed(false);
    try {
      const res = await addNote({ memberId: dossier.memberId, text });
      if (res.ok) {
        setText("");
        setOutcome("Note added. Notes stay on the record and are never edited.");
      } else {
        setFailed(true);
        setOutcome(
          res.error === "validation"
            ? "A note needs some text, up to 2000 characters."
            : "That did not go through. Please try again.",
        );
      }
    } catch {
      setFailed(true);
      setOutcome("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pn-cols">
      <div className="main">
        <PanelCard title="Notes" count={`· ${dossier.notes.length}`}>
          {dossier.notes.length === 0 ? (
            <EmptyState
              eyebrow="Notes"
              message="No notes on this record yet."
            />
          ) : (
            <div className="pn-log">
              {dossier.notes.map((note) => (
                <div key={note.noteId} className="pn-log-row">
                  <span className="pn-when">
                    {note.author} · {fmtGstDateTime(note.created_at)}
                  </span>
                  {/* Notes are written in a textarea; keep their line breaks. */}
                  <p className="pn-meta" style={{ whiteSpace: "pre-wrap" }}>
                    {note.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      </div>
      <div className="rail">
        <PanelCard title="Add a note">
          <label className="pn-label">
            Note (kept on the record; the audit log records that one was added,
            never its text)
            <textarea
              className="pn-input pn-textarea"
              value={text}
              maxLength={2000}
              placeholder="e.g. called about her certificate, resolved"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="pn-btn-row">
            <button
              type="button"
              className="pn-btn pn-btn--sm"
              disabled={busy || text.trim() === ""}
              onClick={() => void submit()}
            >
              {busy ? "Working…" : "Add note"}
            </button>
          </div>
          {outcome !== null ? (
            <p role="status" className={failed ? "pn-error" : "pn-ok"}>
              {outcome}
            </p>
          ) : null}
        </PanelCard>
      </div>
    </div>
  );
}
