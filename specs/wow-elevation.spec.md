# WOW Elevation - polish/wow-experience

Branch: `polish/wow-experience` (off `build/panel-design`, PR #5 head `b22453d`).
Purpose: Issam directed a full end-to-end dry run and an elevation pass that takes the
staged system from good to extraordinary, on its own branch, so he and Mervat can walk
the current version and then switch branches and be "blown away". Direction recorded
2026-07-12. This spec is the plan of record for that pass.

Evidence base: a live dry run of every reachable surface (desktop + mobile, EN + AR,
99 viewport captures), four independent design audits (home/about, secondary pages +
join funnel, Arabic mirror, product-surface reachability), the vault brand brief
([[01 Branding]], v3 Production Readiness record), and the repo architecture map.

## The four findings that drive everything

1. **The motion system fights the visitor.** Reveals run 0.9-1.6s with an 8px blur on
   whole sections including body text; count-ups re-run and get caught mid-value. The
   most frequent visual impression of the site is "still loading".
2. **The middle of the journey is inert.** Partner tiles read as disabled chrome, home
   event cards look tappable and are not, the recognition ladder (the literal brand
   metaphor) is four flat cards, and dark sections over-pad their exits with 150-350px
   of empty navy.
3. **The brand is called The Climb and nothing climbs.** The ascending flight-path
   motif exists everywhere and animates almost nowhere.
4. **The moment of commitment and the Arabic reader both get the economy cabin.**
   /join is a cold form after a cinematic funnel; the Arabic mirror loses the
   typography war (Latin tracking leaks onto Arabic in 12+ places, CTA arrows point
   against reading direction, display weight 800 silently falls back to 700).

## Locks honoured throughout (unchanged)

- Copy is verbatim: no invented facts, names, numbers; no em-dashes; voice rules apply
  to any microcopy that restates already-recorded facts.
- Real logo asset only; gold is recognition-only; concept images stay marked.
- Test-pinned contracts: all getByRole/getByLabel headings and labels listed in the
  e2e suite; `main#main.panel-scope` computed background stays `rgb(246,241,232)`;
  nav `header .links a` real routes; `.ev-arch-card` / `.ev-filter` archive mechanics;
  join form labels, 2 gender radios (Female pre-checked), invisible honeypot.
- The certificate component is sealed. No changes under `src/certificate/`.
- No production deployment, no member import, nothing past staging (hard rule).

## Workstream A - Motion retune + signature "climb" (home.css, tokens.css, home-motion.js)

- A1. Reveal: duration to .55s, translateY to 14px, blur to 4px and removed entirely
  from text-bearing reveals; stagger step 70ms -> 50ms, capped so any section settles
  within ~700ms of entering the viewport. `line-mask` to .7s.
- A2. Count-ups: 600ms, run once on first intersection, final value stays.
- A3. Signature motion: the flight path draws on scroll everywhere it appears (hero,
  spotlight slot route, join band, 404); stat/outcome cards get a one-time 6px rise
  with the count so the band visibly climbs into place.
- A4. Print/no-JS safety: print media query forces reveal end-state (no blank pages).
- A5. Hero: deepen the headline-tail scrim and re-map the gradient so the pale stop
  never sits on the brightest sky; `fetchpriority="high"` + eager decode on the hero
  image (approved v3 follow-on); mobile kicker set to a single non-wrapping clause.

## Workstream B - Inert-middle fixes (home page sections, footer)

- B1. Partner tiles: legible-by-default (white/70 equivalent within tokens), gradient
  sweep + lift on hover, heading rag fixed (no one-word middle line).
- B2. Home event cards become real links to /events/ with the standard card hover
  (lift, border glow); year chip suppressed when the title already starts with it.
- B3. Dead-air trim: over-padded exits on outcomes, events "more" row, join band.
- B4. Footer: single hairline above the legal block (removes the doubled rule), no
  duplicated address block on mobile.
- B5. Outcomes band: the funded-ATPL feature card gets clear visual primacy (scale,
  gold ring emphasis) over the satellite stat cards. Copy untouched.

## Workstream C - Secondary pages (about, membership, get-involved, events, contact)

- C1. Membership recognition ladder becomes The Climb: the four levels step upward
  along a drawn flight path, Leadership Circle in gold at the top; CSS/markup only,
  copy verbatim.
- C2. Membership "who it's for" and "what you get": persona/benefit hierarchy via the
  existing roundel + numbered-card language; uneven card heights fixed.
- C3. Get-involved tiers: visual escalation Supporter (outline) -> Partner (filled) ->
  Champion (gold recognition treatment; it funds the pilot licence).
- C4. Events: timeline years as large display numerals with milestone emphasis;
  highlight cards get photos from the existing archive assets where the archive
  already carries them; archive mechanics (filters, counts, PAGE_SIZE) untouched.
- C5. About: portrait-led board cards (larger photo, LinkedIn demoted to icon), the
  2013 archive photos promoted in size; ambassadors sample grid collapsed into a
  single quiet "coming with launch" strip (existing copy only).
- C6. Contact: the empty right half of the hero carries the flight-path motif and the
  social cards move up into a tighter two-column rhythm; no new copy.
- C7. 404: the diverted flight path draws across the hero; recovery links become the
  standard pill buttons.

## Workstream D - The commitment moment (/join) + product-surface shells

- D1. /join gets the brand seam: dark hero band with the signature curve, the form
  card overlapping the seam; the form itself keeps every field, label, name and the
  honeypot exactly as-is.
- D2. Consent block visually separated from the interests list: custom 20px checkbox
  rendering (same inputs, styled), a hairline divider, "(required)/(optional)"
  unchanged; Turnstile wrapped and labelled with existing security copy pattern.
- D3. Inline email validity hint on blur (aria-invalid + existing error styling);
  no new validation rules, native constraints preserved.
- D4. Verify page: institutional weight - seal-adjacent motif around the existing
  card, the standard page nav/footer stay absent (noindex product surface) but the
  card sits on a designed field instead of a void. Heading text unchanged.
- D5. Portal vs admin sign-in walls visibly differentiated (admin gets the deep navy
  console band per panel-design spec); both keep their pinned headings and paper
  background.
- D6. panel.css light polish only: focus/hover consistency on pn- controls. No layout
  or behavioural changes to the gated PR #5 experience.

## Workstream E - Arabic first-class fixes (ar.css, ar components)

- E1. Letter-spacing war won: a high-specificity RTL reset so Arabic tracking is 0
  everywhere (hero h1, join h2, mission quote, nav links, footer h4, badges, roles).
- E2. CTA arrows mirrored in RTL (scaleX(-1)) with the hover nudge direction flipped,
  matching the panel's existing .pn-arr treatment.
- E3. Display weight: stop requesting the nonexistent 800; set RTL display weight 700
  explicitly and raise display line-height to 1.3 for vocalized Arabic.
- E4. Digits policy: Western digits everywhere (fixes the lone "١" placeholder);
  bidi-isolate stat "+" so 1,300+ renders in the decided order.
- E5. The approved crossover note (the sentence already on MembershipHero) reused
  verbatim beside every Arabic join CTA that lands on the English form.
- E6. RTL flourish: the mirrored flight path draws in on /ar heroes exactly as EN.

## Explicitly deferred to owners (not buildable without new approved content)

- Real member photo/quote for the spotlight (Mervat, P2 list) - the designed slot
  stays; a real woman in the hero imagery; Arabic content parity for the missing
  sections on /ar (home outcomes + spotlight + events, get-involved partner offer,
  about impact) - needs drafted Arabic copy through Mervat's review; an Arabic
  display face decision (v3 follow-on, owner sign-off); patronage strip as a new
  content object (needs copy extraction sign-off).

## Round 2 - "The room that was waiting for you" (2026-07-12, Issam: "a whole lot more")

Issam judged round 1 incremental. Round 2 is a reimagining built on three research
findings (vault deep-mine, world-class benchmarks, asset inventory):

1. **The site advertised with stock photos while the vault holds 700+ frames of real
   professional photography** of real members at real WAI-ME events (2017 Airport Show
   DSLR set, 2025 Riyadh General Assembly set). The events-archive ruling already
   states real event photography needs no concept marker. Every stock frame is
   replaced with the org's own archive, graded to one editorial navy film look:
   hero (2017 front rows), mission (the 2025 certificate stage, the mission line over
   the moment it describes), spotlight portrait, home event cards, the ATPL feature
   card (the very stage where the award was made), events timeline, about, involved.
2. **Arabic display face decided (v3 follow-on): Alexandria** (variable, true heavy
   weights, kufi-leaning geometry that answers Bricolage). AR display lines get their
   own voice instead of borrowing the body face. Proposal for Issam's sign-off.
3. **The 13-year photographic timeline** as the signature section: the events page
   milestone wall built from the 32 cleared archive images.

Owner gates created by round 2: (a) Mervat's publication clearance for the newly
pulled archive photos (list in scripts/prepare-photos.mjs; staging preview only until
cleared); (b) Issam's sign-off on Alexandria; (c) the new Arabic hero alt sentence
for Mervat's language review; (d) photographer attribution for the 2017/2022/2025
shoots is undocumented - confirm with Mervat before production.

## Verification gate for this branch

- `npm run build` clean; `astro check` clean; full vitest suite green; all Playwright
  e2e green (the suite that pinned PR #5's LOCKED SHIP).
- Re-capture of the same 99-viewport walk for side-by-side comparison.
- Reduced-motion pass: every elevated surface fully usable with animations off.
- No changes under convex/ or src/certificate/.
