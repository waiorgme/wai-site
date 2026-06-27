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
| Arabic mirror | `/ar/*` | Same notes, Arabic copy. RTL. Built only after the English page passes all four gates. |

## Brand locks (apply to every row)
Real logo asset only · gold = recognition only · no em-dashes (regular hyphens) ·
concept images marked · copy verbatim from the vault.

## How to build a page
Run `/build-page <name>` in this repo. It runs the four gates in order
(Spec → Build → Design review → Codex source-of-truth audit), then waits for human approval.
