---
name: wai-source-of-truth
description: Use whenever building, editing, reviewing, or auditing any WAI-ME website page or copy. Points to the vault as the single source of truth, lists which vault notes govern which page, and states the brand locks every page must honour. Load this before writing any page content.
---

# WAI-ME source of truth

The website is built **only** from the WAI-ME vault at
`/Users/ismac/Documents/Projects/WAI`. The vault is the single source of truth
(`AGENTS.md` rule 7). No fact, number, name, tier, or sentence may come from model
memory or be invented. When in doubt, the vault wins; if the vault is silent, **stop and
ask** — do not fill the gap.

## The governing notes
- **Drafted copy:** `02 Platform/02 Public Website Content - English (Draft).md`
- **PRD (what each page/flow must do):** `02 Platform/02 PRD - Public Site & Member Portal (Phase 2-3).md`
- **Design system + brand:** `01 Organization/01 Branding.md`
- **Adopted home design ("The Climb" v3):** `02 Platform/Home Design Tournament/winner-home-v3.html`
  and `02 Platform/Home Design Tournament/02 Home Design Tournament - V3 Production Readiness (Record).md`
- **Page → note map:** `SOURCE-MAP.md` in the wai-site repo.

## The locks (every page, no exceptions)
1. **Real logo asset only.** Use the supplied PNG. Never redraw, trace, or CSS-fake the logo.
2. **Gold is recognition only.** `--gold` is for awards/recognition moments; never a generic accent.
3. **No em-dashes.** Every dash on the site is a regular hyphen. By design.
4. **Concept images are marked** with "Concept image, real member photo to follow" until real member photography replaces them.
5. **Copy is verbatim** from the vault. Never rewrite, tighten, or re-translate drafted copy.

## The four gates (chain of custody)
1. `wai-spec` (Claude) — writes acceptance criteria from the vault. Stop-the-Line if no source.
2. `wai-builder` (Claude) — builds the page, reusing v3 components. Adds nothing.
3. `wai-design-review` (Claude, independent) — design-system fidelity. Iterates to PASS.
4. **Source-of-truth audit (Codex, independent)** — every claim traces to a vault note. PASS/FAIL.

Then a human (Issam/Mervat) approves, and the result + a handoff entry are written back to the
vault (`05 Operations/05 Agent Handoff - Log.md`). Exit states ride the handoff log, not a tracker.
