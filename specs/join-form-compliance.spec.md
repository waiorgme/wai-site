# Spec: join-form-compliance slice (Gate 1)

Date: 2026-07-02. Branch: build/join-form-compliance (stacked on build/security-hardening).
Vault sources: `02 PRD Phase 2 - Public Site & Join Flow` §6.2 + §6.3 (P0 items), `02 Signup &
Onboarding Flow (Design)` (plain gender field decision), the gender-field hard rule, the
plain-language rule, `02 Age & Gender Verification Stance (Decision)` (attestation),
`01 Under-18 Members & Mentorship Safeguards (Decision)` (13+ with guardian consent),
`05 Writing Style - No AI Tells` + repo AGENTS.md (no em dashes), audit register BRAND-1/2/4,
FORM-1, COPY-1, and SOURCE-MAP currency (F7).

## Acceptance criteria

1. **Gender field per the decided spec (BRAND-1).** Label "Gender"; exactly two options,
   **Female / Male**, Female pre-selected; no "Woman/Ally" labels, no "Allies are welcome too"
   line, no third option anywhere.
2. **First name + Last name** (PRD §6.2): two required text inputs replacing "Full name";
   letters/spaces/hyphens/apostrophes only, Latin only, length-capped, a pasted sentence is
   rejected with a friendly message. **Name-aware Title Case** applied: `al-sayegh -> Al-Sayegh`,
   `o'brien -> O'Brien`, `mckenzie -> McKenzie`, `bint rashid -> bint Rashid`,
   `sherbaji-khan -> Sherbaji-Khan`. Stored as the single `name` on the member row.
3. **Email**: trimmed + lowercased, well-formed, disposable-domain rejection (small deny-list),
   duplicate email routes to "Welcome back, sign in" (link to /portal) with **no second record
   and no automatic email send**.
4. **Country** single-select from a fixed list (stored to `country_of_residence`).
5. **"What are you hoping we help you with?"** multi-select reusing the LOOKING_FOR options from
   the profile field spec (stored to `looking_for`).
6. **DOB rules** (PRD §6.2): min age 13. Under-13 is refused gently, client and server, nothing
   stored. 13-17 reveals a required **guardian name + guardian email** branch; on submit a
   `guardianConsents` row is created (state pending) and the account stays in the minor lane
   (unusable until guardian confirmation; the confirmation email flow itself is the minor-cert
   slice, per Phase 3 §10).
7. **Truthful-declaration attestation** (PRD P0, verbatim): a required checkbox
   "I confirm my details, including age and gender, are accurate."
8. **Certificate-name confirm step** (PRD P0): after a valid submit, before the account is
   created: "Your certificate will read: <Title-Cased Name>, is that correct?" with a working
   Edit path back to the form.
9. **Consent lines per §6.3**: terms+privacy required; marketing and pipeline separate,
   default OFF, never pre-checked; pipeline label uses the vault's plain wording ("Make my
   profile searchable by corporate partners") instead of raw "opt-in talent pipeline" jargon
   (COPY-1). Explicit false rows still written (existing behaviour, do not regress).
10. **Bot hardening** (PRD P0): hidden honeypot field; a filled honeypot is silently dropped
    (nothing stored, no email sent, unremarkable response). All fields length-capped and
    sanitised server-side. Per-email join rate limit (5/day) + global join cap (300/day) via the
    existing rateLimits mechanism, alongside the existing Turnstile check.
11. **Em-dash cleanup (BRAND-2)**: zero U+2014/U+2013 in member-visible strings across
    src/portal/*.tsx, the five /ar page titles, and ar/Leadership; replaced with regular hyphens
    or restructured sentences. (The Arabic org-name en dash stays until Mervat confirms; it is
    BRAND-3, an owner item.)
12. **BRAND-4**: the `[CONFIRM]` build comment in HowToJoin.astro is reworded so no confirm-token
    text ships in built HTML.
13. **SOURCE-MAP.md current (F7)**: rows for /join, /portal, /verify and the six /ar pages.
14. **Tests**: unit tests for the name-case + name/email/DOB validation logic and the join rate
    rules; the existing E2E suite stays green; a new E2E covers the join form shell (renders,
    gender defaults to Female, honeypot input is hidden).
15. **No behaviour beyond this spec.** Funnel instrumentation (ActivityLog §4.6) is deliberately
    deferred to the claim-wave slice, where the activity table lands.

## Out of scope, recorded
- Guardian confirmation email + minor certificate (Phase 3 §10 slice).
- Onboarding on-ramp items (§6.4): share image, referral links (post-launch fast-follows).
- Privacy/safeguarding/corporate pages (§6.5): the trust-pages slice.
