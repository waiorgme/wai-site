# Operating guide for AI agents: wai-site

This repo is the **build** of the WAI-ME public website. The **vault** at
`/Users/ismac/Documents/Projects/WAI` is the single source of truth for every fact, number,
name, tier, and piece of copy. Read the vault's own `AGENTS.md` rule 7: project knowledge lives
in the vault, never only in a model's memory. If the vault is silent on something, **stop and
ask** — never invent.

## The harness (a right-sized SAFe agentic workflow)
Pages are built one at a time through four gates. Run `/build-page <name>`:

1. **Spec** (`wai-spec`, Claude) — reads the vault, writes acceptance criteria. **Stop-the-Line:** no vault source → halt.
2. **Build** (`wai-builder`, Claude) — builds the page as Astro components, reusing the adopted v3 design. Adds nothing.
3. **Design review** (`wai-design-review`, Claude) — independent design-system gate. Iterates to PASS. Cannot be skipped.
4. **Source-of-truth audit** (Codex, see `.codex/source-of-truth-audit.md`) — independent, cross-model. Every claim traces to a vault note. Cannot be skipped.

Then a human approves and the result is written back to the vault + the handoff log.

## Git workflow (branch per page, part of the harness)
`main` only ever holds pages that cleared all four gates and human approval. No page work is ever
committed directly to `main`, and `main` is never force-pushed.

- **Gate 0 (start of `/build-page <name>`):** branch off main with `git switch -c build/<name>`.
- **During the gates:** commit gate work and fix loops on `build/<name>` (conventional commits).
- **Gate 5 (only after approval + `/handoff`):** `git switch main && git merge --ff-only build/<name> && git branch -d build/<name>`. If the fast-forward is refused, stop and ask rather than forcing.

The repo is local-only today; when it gains a GitHub remote, `build/<name>` branches become pull
requests with no change to the habit. (The vault itself is not yet under version control — separate task.)

## The brand locks (every page)
- Real logo asset only — never redraw or CSS-fake it.
- Gold (`--gold`) = recognition only, never a generic accent.
- No em-dashes anywhere — every dash is a regular hyphen.
- Concept/placeholder images are marked until real member photos replace them.
- Copy is verbatim from the vault.

## Stack
Astro, static output (the decided "Option A": a static site updated by talking to the AI).
English-first with an Arabic RTL mirror under `/ar`. Design tokens are in `src/styles/tokens.css`,
extracted from the adopted `winner-home-v3.html`. See `SOURCE-MAP.md` for page → vault-note mapping.

## Codex ↔ Claude (automated, no copy/paste)
Claude builds and runs the design gate; Codex runs the independent source-of-truth audit.
Claude drives Codex directly through `scripts/codex-audit.sh <page>`, which runs `codex exec`
read-only, pins the reply to `.codex/verdict.schema.json`, and writes a structured verdict to
`.codex/audits/<page>.verdict.json` (exit 0 = PASS, 1 = FAIL, 2 = could not run). Claude reads that
verdict and loops fixes back to the Builder until PASS — nothing is hand-relayed between the two
models. Codex is read-only; Claude records the result and writes the vault handoff entry
(`05 Operations/05 Agent Handoff - Log.md`) as the evidence trail.
