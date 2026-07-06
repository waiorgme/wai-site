# Slice spec: panel-design (the admin console + member panel light redesign)

**Gate 1 spec. Written 2026-07-06 from the vault. Branch: `build/panel-design`.**

## Why this slice exists

Issam's open design thread (handoff log, 2026-07-04): the merged admin panel's minimal
utilitarian look sat far below the Claude Design admin-workspace mockups - "a big gap between
what you delivered and my expectations." The governing design decision is the vault's
[[02 Design Source Brief - Claude Design Reset (Reference)]] (2026-07-01), which LOCKS the
portal + admin theme:

> The member portal and the admin console are **light**: paper base, navy headings, sky-core
> accent, with a **deep navy hero band** at the top of the dashboard for contrast, and **gold
> only** on certificates and standing marks. This is decided, not open. Do not produce a dark
> portal.

The built portal and admin are dark. This slice closes both gaps: the admin console-shell port
and the wider portal light-design migration, in one visual language extended from the adopted
v3 "The Climb" system (the code repo's `src/styles/tokens.css` is the design-system authority).

## Dated scope decisions (recorded here, 2026-07-06)

1. **"Members panels for both Individual and Corporate"** (Issam's instruction) is delivered as:
   the Individual member portal light redesign, plus the **admin-side Partners seam** in the
   console. It is NOT a corporate-facing login or dashboard. Evidence chain: Design Source Brief
   §2 ("Corporate is not self-serve... No corporate form, no tier picker, no payment") and §3.1
   ("Corporate partner / sponsor: No account... Partner-facing portal is a later phase");
   umbrella PRD Phase 2-3 ("builds no partner-facing screens"); Mervat-approved Door 3 decision
   (02 Signup & Onboarding Flow, decision #10). If Issam intended a corporate-facing surface,
   that is a separate decision to record first; this slice keeps the decided model.
2. **/join, /guardian-confirm and /verify migrate to light with the portal.** They share the
   portal's style module today, and the brief frames the light system as what "frames the
   sand-and-gold certificate" (verify) and carries the join flow mockups. Splitting skins would
   create two visual languages on adjacent surfaces, which the design workflow playbook forbids.
3. **No new member-data surfaces.** The admin-panel slice deliberately shipped no member
   browse/search; the deferred DataRequest execution stays deferred. The console's new Overview
   shows **counts only** (PII-free). Members / Partners / Events / Content appear as honest
   designed seams ("Soon"), not implied features.

## Acceptance criteria

### A. Theme lock (the headline fix)
1. `/portal`, `/admin`, `/guardian-confirm`, `/verify`, and the `/join` form section render on
   the light system: `--paper` page ground, white cards with `--hair-l` hairlines and 20px
   radius, `--paper-ink`/`--paper-mut` text, `--sky-core` accent. No dark radial gradients or
   `--ink`-based panels remain on these surfaces.
2. The portal dashboard and the admin console open with a **deep navy hero band** (the locked
   dashboard shape): navy ground, mist/white text, mono eyebrow, content cards on paper below.
3. Gold appears ONLY on recognition: the Founding Member badge and the certificate. The admin
   console remains gold-free. Gold text on light uses `--gold-deep` (AA).
4. Turnstile on /join switches to its light theme. The certificate component itself
   (`src/certificate/MembershipCertificate.tsx`) is a confirmed sealed design: untouched.

### B. Design language (extends v3, never a second language)
5. New shared foundation: light product-surface tokens (semantic ok/error/info states, a light
   focus ring) added additively to `tokens.css`; a `panel.css` stylesheet + small shared React
   primitives power both portal and admin. Existing public-page CSS is not modified.
6. The v3 signature moves carry over: mono uppercase eyebrows with the tick, JetBrains Mono for
   IDs/numbers/labels (tabular-nums), pill buttons/chips (sky-core primary on light), white
   20px cards, hairline dividers, dashed "reserved slot" pattern for coming-soon states, the
   kit's navy-tinted small-shadow scale for dense console chrome.
7. All new CSS uses logical properties (RTL-safe), `:focus-visible` rings visible on light
   (sky-core), calm motion on `--ease-out` behind `prefers-reduced-motion`, hover states behind
   `@media (hover:hover)`.

### C. Admin console (the console-shell port)
8. The console gets a real shell: sidebar navigation (desktop) / collapsible nav (mobile) with
   Overview, the four queues by their exact existing names, "Recent panel actions", and honest
   Soon seams (Members, Partners, Events, Content). The safe-actions sentence stays visible
   verbatim: "The safe-actions fallback. Every change here asks you to confirm, and is
   recorded below."
9. New Overview view backed by a new super-admin-gated Convex query (`admin/overview`):
   PII-free counts only - members **registered vs active/claimed shown as distinct numbers**
   (the vault integrity rule: the 1,309 are "registered", never implied active), open counts
   for each of the four queues, and a recent-actions peek (existing audit query). Every number
   labelled in plain words.
10. Every existing queue behavior survives byte-for-byte in meaning: exact queue names, row
    copy, empty/loading states, propose-then-confirm via the shared ConfirmAction (trigger ->
    plain-language summary + note inputs -> explicit "Yes, ..." -> inline `role="status"`
    outcome), PII masking (masked names, opaque duplicate groups, one-at-a-time audited email
    reveal), pipeline Approve disabled without consent on file, archive offered only when a
    live pair shares the email, suppressed-minor rows read-only, guardian queue resend-only
    (never a confirm-consent control), data-request execution absent with its standing
    disclosure, audit log read-only.
11. Deny-by-default gate preserved: AuthLoading / sign-in ("Admin sign-in", "Send sign-in
    link") / neutral "Not available" card / console. noindex + robots Disallow + sitemap
    absence preserved; exactly one `<noscript>` on the page.
12. Two recorded quirk fixes (behavior, deliberate): the pipeline queue gets separate
    note state per action (approve vs reject), matching the documented separate-fields
    invariant of the other queues; ConfirmAction failures return to the propose step so an
    action is retryable after a validation miss (success outcomes stay terminal; the two-step
    confirm is never collapsed).

### D. Member portal (the light migration)
13. Dashboard keeps its exact early-return ladder and every lane/state variant (loading ->
    no-member -> claimable -> held -> waiting -> youth -> editing -> choosing -> adult), with
    the hero band applied to the signed-in member states. The adult dashboard reads as the
    locked design: greeting + a member ID strip in the hero (name, standing in plain words,
    Membership Number WAIME-n and year when issued), the certificate as a proper card with its
    recognition accents, quick-action cards, and the three coming-soon tiles as dashed
    reserved slots that are visibly not live.
14. ProfileEditor, Settings, YourData, ClaimFlow, JoinApp, GuardianConfirmApp, VerifyApp are
    restyled on the same foundation with ALL copy verbatim and all behavioral invariants
    preserved, including: YourData reachable in every signed-in state incl. minors; pipeline
    section hidden for allies; attestation two-step before pipeline ON; "Turn it off"
    revocation always present un-gated; male selection clears the pipeline tick; minor DOB
    hides pipeline consent and mentor options; honeypot stays `display:none` inline +
    aria-hidden + tabIndex -1; the 8s slow-timeout trust rule on verify/guardian-confirm;
    guardian consent fires only on the button press; claim success still relies on the live
    query re-render.
15. Accessibility does not regress and improves where cheap: existing `role="status"` and
    aria-pressed preserved; new outcome/feedback messages get `role="status"`; nav landmarks
    labelled; the console sidebar is keyboard navigable; heading hierarchy stays h1 -> h2.

### E. Proof
16. `npx tsc --noEmit`, `npm run check`, `npm test`, `npm run build`, `npm run test:e2e` all
    green. No existing test is weakened; the existing selector contract (headings, labels,
    honeypot visibility, noscript counts, noindex) still passes unmodified.
17. New tests: vitest coverage for the overview query (non-admin neutral refusal, counts
    correct, registered vs active distinct); new e2e spec asserting the light theme actually
    rendered (computed paper background + visible sign-in headings on /portal and /admin),
    and the /verify no-token shell + noindex (closing the named coverage gap).
18. No em dashes in any new string. No new PII in the browser. No UI implying unbuilt
    capability. Design review (Gate 3) + Codex review (Gate 4, `scripts/codex-review.sh
    panel-design`) both pass before the PR is opened for Issam.

## Sources
[[02 Design Source Brief - Claude Design Reset (Reference)]] · [[01 Branding]] ·
[[02 Frontend Design Workflow - WAI-ME (Playbook)]] · [[02 Member Profile Field Spec (Talent
Pipeline)]] · [[02 Signup & Onboarding Flow (Design)]] · [[02 PRD Phase 3 - Member Portal]] ·
[[02 Admin Approach - Agent-Operated]] · [[02 Admin Roles (Decision)]] · specs/admin-panel.spec.md ·
the 2026-07-04 handoff-log thread · `src/styles/tokens.css` (design-system authority)
