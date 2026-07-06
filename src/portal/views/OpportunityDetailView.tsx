import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EmptyState, Modal, PanelCard } from "../../panel/kit";
import {
  applicationStateWord,
  gulfDeadlineLabel,
  opportunityTypeWord,
} from "../format";
import type { PortalGo } from "../PortalShell";

// One opportunity (spec B6): description, what to submit, and the apply flow
// as "confirm what we have" - her profile summary plus a statement, sent via
// a confirm step. Evergreen listings show the claim path and take no
// applications. A profile_incomplete refusal routes her to the profile editor
// with a plain explanation.

const STATEMENT_MAX = 5000;

export function OpportunityDetailView({
  id,
  go,
}: {
  id: Id<"opportunities">;
  go: PortalGo;
}) {
  const opportunity = useQuery(api.opportunities.getOpportunity, { id });

  const crumbs = (
    <nav className="pn-crumbs" aria-label="Breadcrumb">
      <button
        type="button"
        className="pn-crumb"
        onClick={() => go({ v: "opportunities" })}
      >
        Opportunities
      </button>
      <span className="sep">›</span>
      <span aria-current="page">
        {opportunity === undefined || opportunity === null
          ? "Listing"
          : opportunity.title}
      </span>
    </nav>
  );

  if (opportunity === undefined) {
    return (
      <>
        {crumbs}
        <p className="pn-meta">Loading…</p>
      </>
    );
  }
  if (opportunity === null) {
    return (
      <>
        {crumbs}
        <EmptyState
          eyebrow="Opportunities"
          message="This listing isn't open anymore. Your applications keep their results either way - they're on the board page."
          action={
            <button
              type="button"
              className="pn-btn pn-btn--ghost pn-btn--sm"
              onClick={() => go({ v: "opportunities" })}
            >
              Back to the board
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
        <p className="pn-eyebrow">{opportunityTypeWord(opportunity.type)}</p>
        <h1 className="pn-h1">{opportunity.title}</h1>
        {(opportunity.partner_name !== null ||
          opportunity.deadline !== null) && (
          <p className="pn-hero-meta">
            {opportunity.partner_name !== null && (
              <span>With {opportunity.partner_name}</span>
            )}
            {opportunity.deadline !== null && (
              <span>Closes {gulfDeadlineLabel(opportunity.deadline)}</span>
            )}
          </p>
        )}
      </section>

      <PanelCard title="About it">
        {opportunity.description
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .map((line, i) => (
            <p className="pn-muted" key={i}>
              {line}
            </p>
          ))}
        {opportunity.eligibility_note !== null && (
          <p className="pn-meta">
            <strong>Who it's for:</strong> {opportunity.eligibility_note}
          </p>
        )}
      </PanelCard>

      {opportunity.type === "evergreen" ? (
        <PanelCard title="How to claim it">
          <p className="pn-meta">
            This is an ongoing member benefit - there's no application and no
            deadline.
          </p>
          {opportunity.how_to_claim !== null ? (
            <p className="pn-muted">{opportunity.how_to_claim}</p>
          ) : (
            <p className="pn-muted">
              The claim steps are on their way. If you need them now, email{" "}
              <a href="mailto:support@waiorg.me">support@waiorg.me</a>.
            </p>
          )}
        </PanelCard>
      ) : opportunity.my_application_state !== null ? (
        <MyApplicationCard
          id={id}
          state={opportunity.my_application_state}
          statement={opportunity.my_statement}
          title={opportunity.title}
        />
      ) : (
        <ApplyCard
          id={id}
          title={opportunity.title}
          whatToSubmit={opportunity.what_to_submit}
          go={go}
        />
      )}
    </>
  );
}

// She already applied: state in plain words, her statement, and a withdraw
// action while the application is still in play.
function MyApplicationCard({
  id,
  state,
  statement,
  title,
}: {
  id: Id<"opportunities">;
  state: "received" | "shortlisted" | "won" | "lost" | "withdrawn";
  statement: string | null;
  title: string;
}) {
  const withdraw = useMutation(api.opportunities.withdrawMyApplication);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const doWithdraw = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await withdraw({ opportunityId: id });
      setMessage(
        res.ok
          ? "Done - your application is withdrawn."
          : "We couldn't withdraw that. Please try again.",
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <PanelCard title="Your application">
      <div className="pn-row-head">
        <span
          className={state === "won" ? "pn-tag pn-tag--ok" : "pn-tag pn-tag--info"}
        >
          {applicationStateWord(state)}
        </span>
        <span className="pn-meta">
          {state === "received"
            ? "Received - every applicant hears back."
            : state === "shortlisted"
              ? "Shortlisted - you're in the final group."
              : state === "won"
                ? "Congratulations - this one is yours."
                : state === "lost"
                  ? "Not this time. Thank you for putting yourself forward."
                  : "You withdrew this one. While the listing is open you can apply again."}
        </span>
      </div>
      {statement !== null && statement !== "" && (
        <p className="pn-meta">
          <strong>Your statement:</strong> {statement}
        </p>
      )}
      {(state === "received" || state === "shortlisted") && (
        <div className="pn-actions">
          <button
            type="button"
            className="pn-link"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Withdraw my application
          </button>
        </div>
      )}
      {message !== null && (
        <p className="pn-meta" role="status">
          {message}
        </p>
      )}
      {confirming && (
        <Modal
          title="Withdraw your application?"
          sub={title}
          onClose={() => setConfirming(false)}
          onConfirm={() => void doWithdraw()}
          confirmLabel="Yes, withdraw it"
          cancelLabel="Keep it in"
          confirmDisabled={busy}
          footNote="While the listing is open, you can apply again afterwards."
        />
      )}
    </PanelCard>
  );
}

// The apply flow: confirm what we have (her profile summary as we'd send it)
// plus a statement, submitted through a confirm step.
function ApplyCard({
  id,
  title,
  whatToSubmit,
  go,
}: {
  id: Id<"opportunities">;
  title: string;
  whatToSubmit: string | null;
  go: PortalGo;
}) {
  const profile = useQuery(api.members.getMyProfile);
  const apply = useMutation(api.opportunities.apply);
  const [statement, setStatement] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const doApply = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apply({ opportunityId: id, statement });
      if (res.ok) {
        setMessage(
          "Application sent. Every applicant hears back, win or lose - watch your notifications.",
        );
      } else if (res.error === "profile_incomplete") {
        setConfirming(false);
        go({
          v: "profile",
          notice:
            "Finish these profile basics first - partners see them with your application. Then come back to the board and apply.",
        });
        return;
      } else if (res.error === "closed") {
        setMessage(
          "This one closed before your application arrived - sorry. New opportunities appear on the board.",
        );
      } else if (res.error === "validation") {
        setMessage(
          "Write a few words about why you're applying - the statement can't be empty.",
        );
      } else {
        setMessage("That didn't work. Please try again.");
      }
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <PanelCard title="Apply">
      {whatToSubmit !== null && (
        <p className="pn-meta">
          <strong>What to submit:</strong> {whatToSubmit}
        </p>
      )}

      <p className="pn-muted">
        <strong>Confirm what we have.</strong> This summary goes with your
        application - if something's off, fix it in your profile first.
      </p>
      {profile === undefined ? (
        <p className="pn-meta">Loading your details…</p>
      ) : profile === null ? (
        <p className="pn-meta">
          We couldn't load your profile. Refresh and try again.
        </p>
      ) : (
        <>
          <p className="pn-meta">
            <strong>{profile.name}</strong>
            {profile.country_of_residence !== "" &&
              ` · ${profile.country_of_residence}`}
            {profile.career_stage_answer !== "" &&
              ` · ${profile.career_stage_answer}`}
            {profile.function_area !== "" && ` · ${profile.function_area}`}
            {profile.role !== "" && ` · ${profile.role}`}
          </p>
          <button
            type="button"
            className="pn-link"
            onClick={() => go({ v: "profile" })}
          >
            Fix something in my profile
          </button>
        </>
      )}

      <label className="pn-label">
        Why you - a few honest lines
        <textarea
          className="pn-input pn-textarea"
          value={statement}
          maxLength={STATEMENT_MAX}
          onChange={(e) => setStatement(e.target.value)}
        />
      </label>

      <div className="pn-actions">
        <button
          type="button"
          className="pn-btn"
          disabled={busy || statement.trim() === ""}
          onClick={() => setConfirming(true)}
        >
          Apply
        </button>
        <span className="pn-meta">
          One application per member. Every applicant hears back.
        </span>
      </div>

      {message !== null && (
        <p className="pn-meta" role="status">
          {message}
        </p>
      )}

      {confirming && (
        <Modal
          title="Send your application?"
          sub={title}
          onClose={() => setConfirming(false)}
          onConfirm={() => void doApply()}
          confirmLabel={busy ? "Sending…" : "Yes, send it"}
          confirmDisabled={busy}
          footNote="We send your profile summary and your statement. You'll get an answer either way."
        />
      )}
    </PanelCard>
  );
}
