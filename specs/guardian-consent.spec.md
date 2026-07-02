# Spec: guardian-consent slice (Gate 1)

Date: 2026-07-02. Branch: build/guardian-consent (off main, post-public-switch: merges via PR).
Launch blocker: a 13-17 join currently parks at `pending_guardian` forever; nothing emails the
guardian and nothing can confirm.

Vault sources: `01 Under-18 Members & Mentorship Safeguards (Decision)` (verified guardian
consent = name + email + a REAL confirmation step, never a self-ticked box; youth membership
certificate; under-18 block list), `01 Under-18 Launch Copy (Drafts)` §1 (the guardian email,
VERBATIM subject + body + button; what we record) and §2 (the Aviation for Girls youth dashboard,
verbatim, shown "in place of the adult dashboard"), `02 Stage 0 - Technical Design` §4.1 age block
(`date_of_birth_source: guardian_confirmed`, `age_confidence: confirmed`,
`guardian_consent_state`), §4.3 GuardianConsent (`pending | confirmed | expired`,
`confirmation_token_hash`), §6 lifecycle (`pending_guardian -(guardian confirms)-> active`),
§7 `captureGuardianConsent` (capture at join - already shipped - and confirm by token),
`02 Privacy & Data Protection (Decision)` (record: guardian name, email, the consent action,
date + policy version), `02 Certificates - In-House Engine (Decision)` (issue on reaching
active; the "minor cert after guardian consent" fast-follow recorded 2026-06-30),
`02 Send Limits` posture (transactional email via Resend, app-capped).

## Acceptance criteria

1. **Send the guardian email at the right moment.** When a 13-17 member verifies her email and
   lands at `pending_guardian` (the auth hook), the guardian confirmation email is sent to the
   recorded guardian via Resend, transactionally. Copy is the vault draft VERBATIM (subject
   "Please confirm, your child would like to join Women in Aviation Middle East"; the body's
   what-joining-means list; the consent button line; support route; sign-off), with
   [Guardian name] / [Applicant first name] filled from the stored rows, [she/they] rendered as
   "she", and the two links pointing at /safeguarding and /privacy. Plain text (matches the
   magic-link email's format), no em dashes.
2. **A real, safe confirmation step.** The email's button links to a public confirm page with an
   unguessable one-time token (>=128-bit random; only its SHA-256 hash is stored, replacing the
   placeholder hash written at join). Confirmation happens by an explicit BUTTON PRESS on that
   page (a POST-equivalent mutation), never on GET, so mail-scanner prefetch can't consent for
   the guardian. Tokens are single-use and expire after 30 days (state `expired`; the page offers
   the support route). Invalid/expired/used tokens all render the same neutral state (no
   enumeration, no member data leaked to an invalid token holder).
3. **What confirmation does.** In one transaction: GuardianConsent -> `confirmed`; member
   `guardian_consent_state = confirmed`, `date_of_birth_source = guardian_confirmed`,
   `age_confidence = confirmed`; lifecycle `pending_guardian -> active` (legal §6 transition);
   the membership certificate is issued (her first win, the youth membership certificate per the
   Under-18 decision); audit rows for the confirmation and the lifecycle change (no guardian PII
   in summaries). Idempotent: a second press of an already-confirmed token shows the friendly
   already-done state and changes nothing.
4. **Resend, bounded.** A signed-in `pending_guardian` member can re-send the guardian email from
   her waiting panel ("Send it again"), throttled server-side (max 1 per hour, 3 per day per
   member, reusing the rateLimits mechanism); re-sending rotates the token (old one invalidated).
   Sends and refusals audited. Guardian email sends also count against the global daily send cap
   (they share the Resend budget with magic links).
5. **The youth dashboard.** An ACTIVE member in the `minor` lane sees the Aviation for Girls
   signpost dashboard (vault §2, verbatim: welcome line, the four AFG items, the explore button
   to WAI International's official AFG page, the at-18 line) in place of the adult tiles, plus
   her certificate section. No mentorship, directory, pipeline, opportunities or settings toggles
   are rendered for her (the servers already refuse them; the UI now matches).
6. **Copy locks.** All member- and guardian-facing strings verbatim from the vault where a draft
   exists; plain language; no em dashes; the youth panel keeps the protected-experience promises
   truthful (nothing it names as excluded is reachable).
7. **No behaviour beyond this spec.** The at-18 graduation prompt, guardian re-confirmation for
   events/photos, and the guardian revocation portal stay out (revocation remains the recorded
   email route via support@waiorg.me per the privacy policy). The admin queue for stuck
   pending-guardian rows belongs to the admin-panel slice.
8. **Tests.** Unit: token generate/hash/verify + expiry window logic. Convex: full happy path
   (minor joins -> guardian row pending -> confirm -> active + cert + audit), expiry, single-use,
   idempotent re-confirm, resend throttle + token rotation, no-enumeration (invalid token),
   confirm never fires on lookup alone. E2E: the /guardian-confirm shell renders (heading,
   guidance, noscript, noindex) - the suite runs without a Convex deployment, so token-state
   rendering (invalid/confirmable/confirmed) and signed-in youth-dashboard rendering are
   exercised at the Convex layer plus the design-review gate, not by Playwright sign-in.
   *AMENDED 2026-07-02 (Gate 4 loop):* used-token lookups return the same neutral invalid as
   unknown/expired tokens (criterion 2's no-enumeration rule wins at the query); the friendly
   already-done reply exists only on the explicit confirm mutation (criterion 3). Expiry is
   persisted by a scheduled marker armed at send time, not only on a confirm attempt. The
   resend endpoint is an ACTION whose ok means Resend accepted the email; failures roll the
   previous token back so the last DELIVERED link keeps working, and every refusal/failure
   path is audited. The guardian row now carries the consent proof (confirmed_at +
   policy_version), completing the vault's "what we record" list.

## Out of scope, recorded
- At-18 graduation prompt (Stage 0 age-up flow) - its own slice.
- Guardian event/photo re-confirmation (Under-18 decision, later phase).
- Admin visibility of pending/expired guardian consents - admin-panel slice.
- Localised (Arabic) guardian email - EN first like all transactional mail; revisit with the
  Arabic copy confirmations.
