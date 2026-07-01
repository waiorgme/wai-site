# Spec: trust-pages slice (Gate 1)

Date: 2026-07-02. Branch: build/trust-pages (stacked on build/join-form-compliance).
Vault sources: `02 Privacy Policy & Guardian Consent (Draft)` Part 1 (the public privacy policy,
verbatim), `01 Under-18 Launch Copy (Drafts)` §3 (the public safeguarding statement, verbatim),
`02 PRD Phase 2` §6.5 (privacy + safeguarding pages are P0), audit register LEGAL-1, UX-1, SEO-1
(sitemap/robots/canonical/hreflang/404 part), SEC-6 follow-through (robots), brand locks.

## STOP-THE-LINE, raised to Issam
The footer links to a **Terms and Conditions** page, but the vault holds NO membership-terms copy.
This slice does not invent legal terms. The /terms footer link stays pointing at the old site until
Issam decides: (a) Claude drafts a `02 Membership Terms (Draft)` vault note for review, then builds
the page from it, or (b) the Terms link is dropped at cutover until terms exist.

## Acceptance criteria

1. **/privacy page (LEGAL-1).** Built verbatim from the vault draft Part 1 (headings + body),
   styled with the site's own tokens, EN nav + footer. "Last updated" = 24 June 2026 (the
   POLICY_VERSION already stamped on consent rows). The pre-launch legal review remains a launch
   gate tracked in Tasks; the page itself carries no draft banner (staging site).
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
