# Staging Checklist - WAI-ME site

**Status: STAGING.** This file is the single authoritative list of placeholder / test-data
elements that are intentionally present on the staging site so the team can see the full
page layout before the real, vault-sourced content exists.

## Gate 4 rule (read by the Codex source-of-truth audit)

A claim on a page that has no vault source is normally a **FAIL**. It is allowed **only when
both** of these are true:

1. it is **visibly marked** as placeholder / test data on the rendered page, **and**
2. it is **listed below** for that page, with a clear "clear-before-production" requirement.

When both hold, Codex records the item under `staging_allowances` in its verdict (not
`orphan_claims`) and it does **not** block a staging PASS. If only one of the two is true
(marked but not listed, or listed but not marked), it is still a FAIL.

Every entry here MUST be cleared before production launch: real vault-sourced content in
place, the on-page marker removed, and the entry deleted from this file. A production audit
treats any remaining open entry as a launch blocker.

## Open staging allowances

### SA-ABOUT-AMBASSADORS
- **page:** about
- **section:** Ambassadors (within Leadership)
- **placeholder:** Sample/illustrative Ambassador cards (names, roles, one-line bios) - test
  data, not real members. (The section heading + intro copy are now APPROVED and recorded in the
  vault, so they are no longer placeholders.)
- **on-page marker:** the section head carries a visible "Sample cards below - real Ambassadors
  to follow" note, and each card carries a "Sample" tag.
- **vault gap:** heading + intro copy approved 2026-06-28 (Issam) and recorded in `02 Platform/
  02 Public Website Content - English (Draft).md`, About Ambassadors. Remaining gap: Mervat
  picks the first launch Ambassadors; no names, photos, or one-line descriptions exist yet.
- **clear-before-production:** Mervat selects the first launch Ambassadors and records their
  names, photos, and one-line descriptions in the vault. Then replace the sample cards with the
  vault-sourced content, remove the note and "Sample" tags, and delete this entry.

### SA-ABOUT-BOARD-PHOTOS
- **page:** about
- **section:** Leadership (the board grid)
- **placeholder:** The six board portraits are REAL board members but harvested from the
  previous live site (`waiorgme/wairme2`, last pushed April 2025), so they are dated. Sources
  catalogued in `02 Platform/02 Legacy Live Site - Reference & Asset Inventory (Reference).md`.
- **on-page marker:** the Leadership header carries a visible note, "Board photos are from the
  current site and will be refreshed before launch."
- **vault gap:** no current, consented board portraits exist in the vault yet; the refresh is
  already tracked as a Mervat pre-launch item ("Board bios + photos") in `Tasks - What's Next`.
- **clear-before-production:** Mervat supplies refreshed, consented board portraits (and the
  one-line bios). Replace the dated photos at `public/assets/team/`, remove the header note,
  and delete this entry.
