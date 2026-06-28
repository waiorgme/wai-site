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
- **placeholder:** Sample/illustrative Ambassador cards (names, roles, one-line bios). These
  are test data, not real members.
- **on-page marker:** the section carries a visible "Test data - not real members" staging
  banner, and each card carries a "Sample" tag.
- **vault gap:** the governing About note (`02 Platform/02 Public Website Content - English
  (Draft).md`, About Ambassadors) says the section shows active members who help run the
  community, photo and one line each, and that Mervat picks the first launch Ambassadors. No
  names, photos, or one-line descriptions exist in the vault yet.
- **clear-before-production:** Mervat selects the first launch Ambassadors and records their
  names, photos, and one-line descriptions in the vault. Then replace the test data with the
  vault-sourced content, remove the staging banner, and delete this entry.
