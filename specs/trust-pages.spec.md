# Spec: trust-pages slice (Gate 1)

Date: 2026-07-02. Branch: build/trust-pages (stacked on build/join-form-compliance).
Vault sources: `02 Privacy Policy & Guardian Consent (Draft)` Part 1 (the public privacy policy,
verbatim), `01 Under-18 Launch Copy (Drafts)` §3 (the public safeguarding statement, verbatim),
`02 PRD Phase 2` §6.5 (privacy + safeguarding pages are P0), audit register LEGAL-1, UX-1, SEO-1
(sitemap/robots/canonical/hreflang/404 part), SEC-6 follow-through (robots), brand locks.

## STOP-THE-LINE - RESOLVED 2026-07-02
The footer linked a Terms page with no vault terms copy behind it. Issam decided: Claude drafts,
building on the live site's old T&C. Done: vault note `02 Membership Terms & Website Conditions
(Draft)` (goes into the combined legal review), /terms built verbatim from it, both footers now
link internally.

## OWNER DECISION - RESOLVED 2026-07-02 (Issam: "amend draft now")
The four mismatches below were fixed in the vault draft (see its changelog) and re-flowed onto the
page the same day; POLICY_VERSION bumped to 2026-07-02. The legal review checks the amended text.
Original finding kept for the record:

### (was) privacy draft vs the shipped product
The /privacy page renders the vault draft verbatim, but the Gate 3 review found the DRAFT ITSELF
misdescribes the product in four places. The fix is a vault amendment (then re-flow the page), not a
builder rewrite; these must not survive to launch:
1. "What we collect ... mobile number" - the join form collects no mobile number.
2. "What we collect" omits DATE OF BIRTH (collected from everyone) and guardian name/email
   (collected for 13-17s). Collecting undisclosed personal data is the worst direction of mismatch.
3. "use the 'manage my data' options in your member area" - no such portal UI exists yet
   (email route is real). Reword or build before launch.
4. "we note where each stores data" - the page never lists hosting regions; add a region note or
   soften the sentence at the legal review.
Also confirm before launch: the Cloudflare Web Analytics beacon is dashboard-injected (not in markup).

## Acceptance criteria

1. **/privacy page (LEGAL-1).** Built verbatim from the vault draft Part 1 (headings + body),
   styled with the site's own tokens, EN nav + footer. "Last updated" = 2 July 2026, matching the
   amended draft and the bumped POLICY_VERSION (2026-07-02) stamped on consent rows. *(AMENDED
   2026-07-02: this criterion originally said 24 June 2026; superseded the same day when Issam
   resolved the LEGAL-2 mismatches by amending the vault draft, see the resolved owner-decision
   section above.)* The pre-launch legal review remains a launch gate tracked in Tasks; the page
   itself carries no draft banner (staging site).
   **Data-request route (PRD §6.5 P0) - DEFERRED, recorded 2026-07-02:** the PRD asked for a
   "request your data / delete your data" route creating a DataRequest via `submitDataRequest`
   (Stage 0 §7). The Issam-approved LEGAL-2 amendment made the privacy policy say, verbatim: "To
   exercise any of these, email support@waiorg.me" and "(As the member area grows, these options
   will also appear there directly.)" - the email route IS the launch mechanism; the DataRequest
   table + action + admin handling belong to the recorded next-priority admin-panel slice. The
   deferral note is also recorded in the vault PRD §6.5.
2. **/safeguarding page.** Built verbatim from the vault's public statement ("Keeping Our Young
   Members Safe"), same treatment. The privacy-policy cross-reference links to /privacy.
3. **Footer updates (EN + AR):** Privacy Policy links to /privacy (internal), a Safeguarding link
   is added, Terms handling per the stop-the-line above.
4. **UX-1 resilience.** /join, /portal and /verify each render a <noscript> message (plain
   language, support@waiorg.me) and /verify shows a friendly "we can't reach the server right now"
   state if the certificate lookup gets no answer within a timeout, instead of spinning forever.
5. **robots.txt**: allows the site, disallows /portal and /verify, points at the sitemap.
6. **Sitemap** (@astrojs/sitemap) covering the public pages, excluding /portal and /verify.
7. **Canonical URLs + og:url** on every page, absolute, from a single site constant
   (https://www.waiorg.me). og:locale becomes en_US / ar_AE.
8. **hreflang**: reciprocal EN <-> AR alternates with absolute URLs on all six page pairs,
   plus x-default pointing at the EN page.
9. **noindex** meta on /portal and /verify (belt to the robots braces).
10. **404 page** in the site's design: plain-language message, links Home / Join / Contact,
    EN with an Arabic line.
11. **Organization JSON-LD** on the EN and AR home pages (name, url, logo, parent organisation,
    sameAs socials already in the footer, contact email).
12. **Tests**: existing suites stay green; new E2E asserts /privacy and /safeguarding render with
    their H1s, robots.txt and sitemap exist in the build, and the 404 page renders.
13. No copy invention anywhere: every sentence on the two new pages traces to its vault note.
