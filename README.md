# wai-site

The new Women in Aviation Middle East public website. Built page-by-page from the WAI-ME vault
(the single source of truth) through a five-gate AI build harness.

## Quick start
```bash
npm install
npm run dev      # local preview on http://localhost:4321
npm run build    # static output to dist/
```

## How pages are built
Run `/build-page <page>` in Claude Code. It runs five gates and waits for human approval:

| Gate | Owner | Model | Can skip? |
|------|-------|-------|-----------|
| 1. Spec (acceptance criteria from the vault) | `wai-spec` | Claude | Stop-the-Line: halts if no vault source |
| 2. Build (Astro components, reuse v3) | `wai-builder` | Claude | no |
| 3. Design review (design-system fidelity) | `wai-design-review` | Claude | **non-collapsible** |
| 4. Source-of-truth audit (every claim traces to a vault note) | Codex | Codex | **non-collapsible** |
| 5. Interaction tests (Playwright, asserts rendered state) | `npm run test:e2e` | — | **non-collapsible**, enforced in CI |

The two independent gates are intentionally split across **two different models** (Claude builds,
Codex audits) for genuine cross-model independence. This is a right-sized adaptation of
[safe-agentic-workflow](https://github.com/bybren-llc/safe-agentic-workflow): its spine
(Stop-the-Line, independent non-collapsible gates, evidence-based chain of custody) without the
SWE-team bulk.

### Gate 4 is automated — no copy/paste between models
Claude runs Codex directly via `scripts/codex-audit.sh <page>`. That wrapper calls `codex exec`
read-only, forces the reply to match `.codex/verdict.schema.json`, and writes a structured verdict
to `.codex/audits/<page>.verdict.json`:

```bash
scripts/codex-audit.sh home   # exit 0 = PASS, 1 = FAIL, 2 = could not run
```

Claude reads the verdict, and on FAIL feeds `required_fixes` back to the Builder, rebuilds, and
re-audits until PASS. You never relay findings by hand. Codex is read-only; Claude records results
and writes the vault handoff entry. Audit verdicts are kept under `.codex/audits/` as the evidence
trail (logs are gitignored).

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

## License and reuse
This repository is published for transparency: Women in Aviation Middle East runs on volunteers,
and making the build public is what gives us free enforced branch protection, secret scanning and
code analysis. Publication is not an open-source grant:

- The **code** carries no open-source license. All rights reserved; you may read it, but no
  license is granted to reuse it.
- The **WAI-ME name, logo, and brand assets** are not licensed for any reuse.
- The **site content** (copy, images, certificates, member-facing text) is all rights reserved.
- **No member data lives in this repository.** The member list is read from a private vault at
  import time only and never enters version control.

Questions: support@waiorg.me.
