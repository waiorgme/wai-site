# wai-site

The new Women in Aviation Middle East public website. Built page-by-page from the WAI-ME vault
(the single source of truth) through a four-gate AI build harness.

## Quick start
```bash
npm install
npm run dev      # local preview on http://localhost:4321
npm run build    # static output to dist/
```

## How pages are built
Run `/build-page <page>` in Claude Code. It runs four gates and waits for human approval:

| Gate | Owner | Model | Can skip? |
|------|-------|-------|-----------|
| 1. Spec (acceptance criteria from the vault) | `wai-spec` | Claude | Stop-the-Line: halts if no vault source |
| 2. Build (Astro components, reuse v3) | `wai-builder` | Claude | no |
| 3. Design review (design-system fidelity) | `wai-design-review` | Claude | **non-collapsible** |
| 4. Source-of-truth audit (every claim traces to a vault note) | Codex | Codex | **non-collapsible** |

The two independent gates are intentionally split across **two different models** (Claude builds,
Codex audits) for genuine cross-model independence. This is a right-sized adaptation of
[safe-agentic-workflow](https://github.com/bybren-llc/safe-agentic-workflow): its spine
(Stop-the-Line, independent non-collapsible gates, evidence-based chain of custody) without the
SWE-team bulk.

## Structure
```
src/styles/tokens.css     The Climb (v3) design tokens, extracted from the adopted home
src/layouts/Base.astro    html shell: fonts, dir/lang, skip link
src/components/           reusable v3 pieces (built during /build-page home)
src/pages/                pages (English); Arabic mirror under /ar
.claude/agents/           the three Claude gates
.claude/commands/         /build-page, /verify-page, /handoff
.claude/skills/           wai-source-of-truth (vault path + brand locks)
.codex/                   the Codex source-of-truth audit role
SOURCE-MAP.md             page → governing vault notes
AGENTS.md                 operating guide for any AI agent in this repo
```

## The single source of truth
The vault at `../WAI` governs all content. Nothing on the site is invented; if the vault is
silent, the build stops and asks. Decisions and results are written back to the vault, never kept
only in a model's memory.
