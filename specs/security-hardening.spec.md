# Spec: security-hardening slice (Gate 1)

Date: 2026-07-02. Source audit: vault `02 Platform/02 Production Readiness Audit - Findings Register (Record)`.
Vault sources of truth: `02 Stage 0 - Technical Design (Public Site & Portal)` (§5 lane evaluator as single
server-side source of truth, §6 lifecycle, §8 audit rows), `02 PRD - Public Site & Member Portal (Phase 2-3)`
(§6.2 join requirements), `02 Under-18 & Mentorship Safeguards` (minors blocked from pipeline),
`02 Send Limits` decision (Resend caps), `01 Branding` + repo AGENTS.md (copy locks: plain language, no em dashes).

## Acceptance criteria

1. **SEC-1 (P0) DOB required at the public join boundary.** `submitJoin` rejects a missing or malformed
   `dobAnswer` server-side (ISO `YYYY-MM-DD`, a real calendar date, not in the future, not before 1900),
   and rejects any DOB under the vault's minimum joining age of 13
   (`01 Under-18 Members & Mentorship Safeguards (Decision)`) before any member or consent row is written.
   `createPendingMember` serves the public join path only and requires the DOB end to end.
   *AMENDED 2026-07-02 (Gate 4 loop):* the original criterion kept an optional DOB on
   `createPendingMember` "for the internal migration path". That sentence pre-dated the decided
   claim-wave design and is superseded by it: per the vault `02 Migration & Claim-Wave Plan (Decision)`,
   the 1,309 legacy rows land in the separate `importedMembers` table (`convex/importedMembers.ts`,
   `build/claim-wave` slice) and a `members` row is only created at claim, with the member present.
   No migration code path calls `createPendingMember`, so an optional DOB there was an unreachable
   loosening, not a feature; its no-DOB regression coverage belongs to the claim-wave slice's import
   tests.
2. **SEC-3 (P1) `restricted_unknown` is never auto-activated.** On magic-link verification,
   `beforeSessionCreation` routes: lane `minor` to `pending_guardian`, lanes `standard`/`ally` to `active`,
   lane `restricted_unknown` to `pending_review` (a legal §6 transition). Certificates are issued only on
   reaching `active`. Net effect with (1): a new signup cannot reach `active` or a certificate without a DOB;
   an unknown-age account waits for human review.
3. **SEC-2 (P0) Rate limiting on magic-link sends.** All sign-in emails (join and portal) pass through one
   server-side choke point with the vault's numbers: per-email limit 3 sends per hour AND 10 per 24h
   (Stage 0 §8, verbatim); a global limit of 90 sends per 24h, deliberately below Resend's free-tier
   100/day hard cap (`02 Email Send Limits - Free-Tier Check (Reference)`) so the app cap always trips
   before the provider cap. The check runs INSIDE the transaction that creates/replaces the verification
   code, so an over-limit or capped request can never invalidate a member's live link. Exceeding a limit
   throws; the join and portal forms show a plain-language "too many attempts, wait and retry" message
   (no jargon, no em dashes). Limits are constants in one file with comments pointing at the vault notes.
   *AMENDED 2026-07-02 (Gate 4 loop):* the original criterion wrote 3 per 15 minutes and a 200/day global
   cap; both conflicted with the vault (Stage 0 §8 says 3/hour, and 200/day cannot protect a 100/day
   provider cap). Numbers corrected to the vault's; raise the global cap only when Resend Pro is
   confirmed active (owner item).
4. **SEC-4 (P1) Photo upload validated server-side.** `updateProfile` accepts a `photo_storage_id` only if
   the stored blob's `contentType` is image/jpeg, image/png, or image/webp AND size is 5 MB or less
   (checked via the `_storage` system table). SVG is rejected. On rejection the profile change is refused
   with a field-level error and nothing is patched.
5. **SEC-5 (P1) Consent lane guard.** Only the `standard` lane may consent into the talent pipeline, on
   BOTH consent paths (join and `writeConsent`): `minor` and `restricted_unknown` are blocked by the
   under-18 safeguards, and `ally` is blocked because the pipeline is women-only (Stage 0 §5: the
   women-only pipeline/scholarship exclusion is enforced centrally). Refusal returns an error envelope
   (settings) or forces an explicit `false` consent row (join), no `true` row is ever written, and every
   refusal is audited.
   *AMENDED 2026-07-02 (Gate 4 loop):* the original criterion named only `minor` and `restricted_unknown`
   and only the `writeConsent` path; the join consent path and the vault's ally exclusion were missing.
6. **SEC-6 (P2) Security headers.** `public/_headers` ships CSP (self + the Convex deployment origin +
   challenges.cloudflare.com for Turnstile + Google Fonts + images.unsplash.com until self-hosting lands),
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
   and a minimal `Permissions-Policy`. Static output copies it into `dist/`.
7. **SEC-7 (P2) Auth dependency pinned.** `@convex-dev/auth` pinned exactly (no caret); a comment records why.
8. **QA-1 (P1) Unit tests exist in the repo.** A committed vitest suite covers `convex/lib`: age derivation
   (adult, minor, boundary birthday, no DOB), lane evaluation (all four lanes, minor-overrides-ally ordering),
   lifecycle transition legality, profile validation (every picklist, role-follows-area, cleared fields) and
   completeness, and the new rate-limit window logic. `npm test` runs them; minimum 19 passing tests.
9. **QA-2 (P1) CI runs the type gate and unit tests.** `.github/workflows/ci.yml` runs `npm run check`
   (astro check) and `npm test` before the E2E job's build.
10. **No behaviour beyond this spec.** No copy rewrites (that is the join-form-compliance slice), no design
    changes, no new pages.

## Out of scope, recorded for later slices
- The §6 lifecycle map does not list `email_unverified -> active` yet the auth hook performs it (consents
  are captured at join, so `consent_pending` is deliberately collapsed). Pre-dates this slice; the claim-wave
  slice should reconcile the map with reality.
- Photo `storage_id` ownership binding (IDs are 128-bit unguessable; validation above bounds the abuse).
- Turnstile on the portal sign-in form (rate limiting covers the abuse channel; revisit if logs show pressure).
