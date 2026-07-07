import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { input, label, muted } from "../portal/ui";
import { ConfirmAction } from "./ConfirmAction";
import { queueSection, rowCard, rowMeta, rowName, tag } from "./ui";
import { plural } from "./views/shared";

// Claim conflicts queue (spec criterion 2, decided mechanic: correct + archive).
// conflict rows can be RELEASED (confirmed as the verified person, optionally
// with a corrected email, back to unclaimed for the normal matchClaim path) or
// ARCHIVED (the non-matching pair row, kept permanently as a conflict trail).
// suppressed_minor rows stay read-only: they clear on their own; no action forces
// a minor's row claimable early.

const reasonCopy: Record<string, string> = {
  duplicate_email: "Two records share this email; a human must decide which is real.",
  missing_legacy_number: "The legacy membership number is missing.",
  dob_mismatch_at_claim: "The date of birth given at claim did not match the record on file.",
};

const readableReason = (raw: string | null, state: string): string => {
  if (raw === null) {
    return state === "suppressed_minor"
      ? "Held until the record shows she is 18; it clears on its own and nothing here needs your action. The one exception: if she has written in asking about her claim, reply personally within 2 working days."
      : "Needs a human review.";
  }
  // The reason may carry appended resolution notes ("base; note"); keep the
  // base's friendly copy but surface the appended trail verbatim.
  const [base, ...rest] = raw.split("; ");
  const head = reasonCopy[base] ?? base;
  return rest.length === 0 ? head : `${head} ${rest.join("; ")}`;
};

export function ClaimConflictsQueue() {
  const rows = useQuery(api.admin.claims.listConflicts);
  const resolve = useMutation(api.admin.claims.resolveConflictAsClaimed);
  const archive = useMutation(api.admin.claims.archiveConflictRow);
  const reveal = useMutation(api.admin.claims.revealContactEmail);

  // Group by the opaque server-provided duplicate_group (never the raw email),
  // so rows sharing an address render together without the browser ever seeing
  // any email string.
  const groups: number[] =
    rows === undefined
      ? []
      : [...new Set(rows.map((r) => r.duplicate_group))];

  return (
    <section className={queueSection}>
      {rows === undefined ? (
        <p className={muted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={muted}>No conflicts waiting.</p>
      ) : (
        groups.map((group) => {
          const groupRows = rows.filter((r) => r.duplicate_group === group);
          const isGroup = groupRows.length > 1;
          return (
            <div
              key={group}
              className={isGroup ? "pn-group" : undefined}
              style={isGroup ? undefined : { display: "contents" }}
            >
              {isGroup && (
                <p className={rowMeta}>
                  These records share one email address.
                </p>
              )}
              {groupRows.map((row) => (
                <ConflictRowCard
                  key={row.rowId}
                  row={row}
                  resolve={resolve}
                  archive={archive}
                  reveal={reveal}
                />
              ))}
            </div>
          );
        })
      )}
    </section>
  );
}

const stateTag: Record<string, string> = {
  conflict: "Conflict",
  suppressed_minor: "Held (under 18)",
  archived_conflict: "Archived",
};

// Tag tone: a live conflict is the one state that needs a human now (err);
// held/archived stay neutral.
const stateTagClass: Record<string, string> = {
  conflict: `${tag} pn-tag--err`,
  suppressed_minor: tag,
  archived_conflict: tag,
};

function ConflictRowCard({
  row,
  resolve,
  archive,
  reveal,
}: {
  row: {
    rowId: string;
    masked_name: string;
    claim_state: "conflict" | "suppressed_minor" | "archived_conflict";
    conflict_reason: string | null;
    match_signals: { email: boolean; name: boolean; mobile: boolean; dob: boolean };
    days_since_change: number;
    duplicate_group: number;
    live_duplicate_count: number;
    shares_email_with_other: boolean;
  };
  resolve: ReturnType<typeof useMutation<typeof api.admin.claims.resolveConflictAsClaimed>>;
  archive: ReturnType<typeof useMutation<typeof api.admin.claims.archiveConflictRow>>;
  reveal: ReturnType<typeof useMutation<typeof api.admin.claims.revealContactEmail>>;
}) {
  // Release and archive keep separate note fields so one action's text can never
  // become the other's value.
  const [correctedEmail, setCorrectedEmail] = useState("");
  const [releaseNote, setReleaseNote] = useState("");
  const [archiveNote, setArchiveNote] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const hasLivePair = row.live_duplicate_count > 1;

  return (
    <div className={rowCard}>
      <div className="pn-row-head">
        <p className={rowName}>{row.masked_name}</p>
        <span className={stateTagClass[row.claim_state] ?? tag}>
          {stateTag[row.claim_state] ?? row.claim_state}
        </span>
        {hasLivePair && row.claim_state === "conflict" && (
          <span className={tag}>Duplicate email pair</span>
        )}
      </div>
      <p className={rowMeta}>{readableReason(row.conflict_reason, row.claim_state)}</p>
      <p className={rowMeta}>
        Compared with the record on file: email{" "}
        {row.match_signals.email ? "matches" : "does not"}, name{" "}
        {row.match_signals.name ? "matches" : "does not"}, mobile{" "}
        {row.match_signals.mobile ? "matches" : "does not"}, date of birth{" "}
        {row.match_signals.dob ? "matches" : "does not"}.{" "}
        {plural(row.days_since_change, "day", "days")} in this state.
      </p>

      {/* Contact email: hidden by default (masked surface). Revealing one row's
          email is a deliberate, audited, one-at-a-time action for the wave-run
          ops routine's personal-email commitment. */}
      {revealed !== null ? (
        <p role="status" className={rowMeta}>
          Contact email: <strong>{revealed}</strong>
        </p>
      ) : (
        <ConfirmAction
          label="Reveal contact email"
          confirmLabel="Yes, reveal"
          summary={
            <>
              Show {row.masked_name}'s email so you can contact her personally.
              This is logged.
            </>
          }
          onConfirm={async () => {
            const res = await reveal({ rowId: row.rowId as never });
            if (res.ok) {
              setRevealed(res.email);
              return { ok: true, message: `Contact email: ${res.email}` };
            }
            return { ok: false, message: "That did not go through. Please try again." };
          }}
        />
      )}

      {row.claim_state === "conflict" && (
        <div className="pn-actions">
          <ConfirmAction
            label="This is the verified person: release"
            confirmLabel="Yes, release"
            summary={
              <>
                Confirm {row.masked_name}'s record as the verified person and
                release it for claim. It re-enters the normal claim path; every
                claim safeguard still applies.{" "}
                {hasLivePair
                  ? "Because another live record shares this email, first archive the other one or give this one a corrected, unique email; otherwise the release is refused."
                  : ""}
              </>
            }
            onConfirm={async () => {
              const res = await resolve({
                rowId: row.rowId as never,
                correctedEmail:
                  correctedEmail.trim() === "" ? undefined : correctedEmail.trim(),
                note: releaseNote.trim() === "" ? undefined : releaseNote.trim(),
              });
              if (res.ok) {
                return { ok: true, message: "Released. It can be claimed again." };
              }
              const message =
                res.error === "email_collision"
                  ? "That corrected email already belongs to another record. Use a different one."
                  : res.error === "duplicate_unresolved"
                    ? "Another live record still shares this email. Archive that one first, or give this one a unique corrected email."
                    : res.error === "validation"
                      ? "That corrected email is not valid."
                      : "That did not go through. Please try again.";
              return { ok: false, message };
            }}
          >
            <label className={label}>
              Corrected email (optional)
              <input
                className={input}
                value={correctedEmail}
                onChange={(e) => setCorrectedEmail(e.target.value)}
                placeholder="leave blank to keep the current email"
              />
            </label>
            <label className={label}>
              Resolution note (optional)
              <input
                className={input}
                value={releaseNote}
                onChange={(e) => setReleaseNote(e.target.value)}
                placeholder="e.g. confirmed by reply from the email on file"
              />
            </label>
          </ConfirmAction>

          {/* Archive is offered only for a duplicate-email group. A single
              conflict (unique email, e.g. a lone DOB mismatch) stays in review
              until it is corrected or released; the server refuses archive for
              it too. */}
          {row.shares_email_with_other && (
            <ConfirmAction
              label="Not this person: archive"
              confirmLabel="Yes, archive"
              summary={
                <>
                  Park {row.masked_name}'s record permanently as an archived
                  conflict (the trail). It is never deleted and never becomes
                  claimable, and it stops blocking its pair from being claimed.
                </>
              }
              onConfirm={async () => {
                const res = await archive({
                  rowId: row.rowId as never,
                  note: archiveNote.trim() === "" ? undefined : archiveNote.trim(),
                });
                return res.ok
                  ? { ok: true, message: "Archived as a conflict." }
                  : { ok: false, message: "That did not go through. Please try again." };
              }}
            >
              <label className={label}>
                Archive note (optional)
                <input
                  className={input}
                  value={archiveNote}
                  onChange={(e) => setArchiveNote(e.target.value)}
                  placeholder="e.g. duplicate belongs to a different person"
                />
              </label>
            </ConfirmAction>
          )}
        </div>
      )}
    </div>
  );
}
