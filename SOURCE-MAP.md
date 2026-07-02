# SOURCE-MAP — page → vault notes it must honour

The vault is at `/Users/ismac/Documents/Projects/WAI` and is the single source of truth.
Each page is built only from the notes listed here. If a page has no copy or Decision note,
the Spec gate stops (Stop-the-Line) until one exists in the vault.

| Page | Route | Governing vault notes |
|------|-------|-----------------------|
| Home | `/` | `02 Platform/Home Design Tournament/winner-home-v3.html` (adopted design) · `02 Platform/02 Public Website Content - English (Draft).md` · `01 Organization/01 Branding.md` |
| About | `/about` | `02 Public Website Content - English (Draft)` (About section) · `01 Organization/` charter/history notes |
| Membership | `/membership` | `02 PRD - Public Site & Member Portal (Phase 2-3)` · `01 Organization/01.02 Membership Model/*` (tiers, recognition thresholds) |
| Get Involved | `/get-involved` | `02 Public Website Content - English (Draft)` · partner/Ambassador Decision notes |
| Events | `/events` | `02 Public Website Content - English (Draft)` (Events) · `04 Events/` (real dates) |
| Contact | `/contact` | `02 Public Website Content - English (Draft)` (Contact) · `05 Operations/05 Tools & Accounts.md` (support email) |
| Join | `/join` | `02 PRD Phase 2 - Public Site & Join Flow` §6.2-6.3 · `02 Signup & Onboarding Flow (Design)` · `02 Member Profile Field Spec (Talent Pipeline)` (career stages, looking-for options) · gender-field + plain-language hard rules |
| Portal (dashboard, profile, certificate) | `/portal` | `02 Stage 0 - Technical Design (Public Site & Portal)` · `02 PRD Phase 3 - Member Portal` · `02 Member Profile Field Spec (Talent Pipeline)` · `02 Certificates - In-House Engine (Decision)` · `02 Certificate Design & Eligibility Rules (Draft)` |
| Certificate verify | `/verify` | `02 Certificates - In-House Engine (Decision)` §6b (valid / superseded / revoked / not found) |
| Privacy Policy | `/privacy` | `02 Privacy Policy & Guardian Consent (Draft)` Part 1 (verbatim; recorded deviations: internal Zoho-EU build instruction dropped, "see Part 2 below" resolved to the /safeguarding link) · combined legal review = launch gate · LEGAL-2 mismatches RESOLVED 2026-07-02 (Issam amended the draft; POLICY_VERSION bumped 2026-07-02; page re-flowed same day, see specs/trust-pages.spec.md) · data-request route deferred to the admin-panel slice per the amended policy (email route is the launch mechanism) |
| Safeguarding | `/safeguarding` | `01 Under-18 Launch Copy (Drafts)` §3 public statement (verbatim) · `01 Under-18 Members & Mentorship Safeguards (Decision)` |
| Terms | `/terms` | `02 Membership Terms & Website Conditions (Draft)` (verbatim; Issam-approved draft 2026-07-02, closes LEGAL-3) · combined legal review = launch gate |
| Not found | `/404` | Utility chrome only (no vault copy claim) |
| Arabic Home | `/ar/` | `02 Public Website Content - Arabic Front Door (Draft)` · same layout notes as `/` |
| Arabic About | `/ar/about/` | Arabic draft (About) · same notes as `/about` |
| Arabic Membership | `/ar/membership/` | Arabic copy on the rendered page (approved batch 2026-06-28) · same notes as `/membership` |
| Arabic Get Involved | `/ar/get-involved/` | Arabic draft (Get Involved) · same notes as `/get-involved` |
| Arabic Events | `/ar/events/` | Arabic copy + `src/data/events-archive-ar.json` (32-entry translated archive) · same notes as `/events` |
| Arabic Contact | `/ar/contact/` | Arabic copy on the rendered page · same notes as `/contact` |

## Brand locks (apply to every row)
Real logo asset only · gold = recognition only · no em-dashes (regular hyphens) ·
concept images marked · copy verbatim from the vault.

## How to build a page
Run `/build-page <name>` in this repo. It runs the four gates in order
(Spec → Build → Design review → Codex source-of-truth audit), then waits for human approval.
