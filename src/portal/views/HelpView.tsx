import { PageHeader, PanelCard } from "../../panel/kit";

// Help & support (vault decision: email is the channel - no tickets, no
// bots). One address, a person replies, plus the two self-serve links that
// genuinely help: certificate verification and the safeguarding page.

export function HelpView() {
  return (
    <>
      <PageHeader
        eyebrow="Help & support"
        title="Help & support"
        sub="One address, a real person. No tickets, no bots."
      />

      <PanelCard title="Write to us">
        <p className="pn-muted">
          Email <a href="mailto:support@waiorg.me">support@waiorg.me</a> with
          anything - your account, an event, an application, or something that
          doesn't look right.
        </p>
        <p className="pn-meta">
          What to expect: a person reads every message and replies from the
          same address, usually within a few days.
        </p>
        <div className="pn-actions">
          <a className="pn-btn pn-btn--sm" href="mailto:support@waiorg.me">
            Email support
          </a>
        </div>
      </PanelCard>

      <div className="pn-grid">
        <PanelCard title="Check a certificate">
          <p className="pn-meta">
            Anyone can check that a WAI-ME certificate is real - no account
            needed. If someone shares one with you, verify it before you rely
            on it.
          </p>
          <a className="pn-link" href="/verify" target="_blank" rel="noopener">
            Open the verify page
          </a>
        </PanelCard>

        <PanelCard title="Members under 18">
          <p className="pn-meta">
            How we keep younger members safe - what's switched off, what a
            parent or guardian confirms, and who to contact.
          </p>
          <a
            className="pn-link"
            href="/safeguarding"
            target="_blank"
            rel="noopener"
          >
            Read the safeguarding page
          </a>
        </PanelCard>
      </div>
    </>
  );
}
