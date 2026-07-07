# Slice spec: panel-experience (the full admin + member experience, round 2)

**Gate 1 spec. Written 2026-07-06. Branch `build/panel-design` (continues PR #5).
Supersedes the visual-only scope of `panel-design.spec.md`; that spec's theme locks stay.**

## Why

Issam reviewed the round-1 redesign against the full Claude Design mockup set (119 artboards,
imported 2026-07-06) and directed: match the mockups' depth, adapt (never copy) to the vault's
decided workflows, keep signup/login exactly as built, and ship the FULL experience - frontend
and backend, with no "coming soon" surfaces. The vault already carries decided models for
events, opportunities, notifications, directory, standing, members admin, partners and
certificates admin (see Sources); this slice builds their decided cores end to end.

## Mockup adaptation rules

- Mockups are the LAYOUT and interaction source: two-column dark-sidebar workspace shells,
  KPI tiles with attention tones, panel + data-table vocabulary, filter bars, tabbed detail
  pages, propose/confirm modals with audit footers, date-block event rows, QR passes,
  notification center. Copy is NEVER taken from mockups.
- Stale mockup concepts stay dead (vault kill list): paid tiers/prices/billing, renewals/
  expiry/grace, membership-type selection, multi-step application review, passwords,
  seven-role matrix, support tickets, volunteers admin, mentorship UI.
- Signup, magic-link sign-in, claim, and guardian-consent flows are UNTOUCHED (Issam,
  2026-07-06).

## What ships (all real, frontend + backend)

### A. Events (vault: Workshop System, Event Cadence, PRD Phase 3 §7.5, Stage 0 §4.5)
1. Schema: `events` (title, category, short/full description, starts_at/ends_at, timezone
   [GST default], format in_person|online, venue/city or meeting_link, host_name/host_email
   [text fields; host workspaces are a later phase], audience_lane adult|youth, capacity
   [the host tool's limit], waitlist on, priority_window_start/end optional,
   registration_closes_at optional, state draft|published|cancelled|postponed|
   attendance_finalized, recording_url/materials_url optional post-event, cancelled_reason).
   `eventRegistrations` (event_id, member_id, state registered|waitlisted|cancelled|attended|
   no_show, checkin_code unguessable, idempotency, promoted_from_waitlist_at optional,
   timestamps).
2. Member: events list (published, upcoming first; youth lane sees ONLY audience_lane=youth -
   "switched off, not supervised"); event detail (date/venue block, description, capacity
   state); one-tap RSVP with seat cap + AUTOMATIC waitlist; when a seat frees, the earliest
   waitlisted member auto-promotes (audited + notified); cancel my RSVP; priority window
   enforced server-side (during the window only standing Active Member+ may take a seat,
   plain-language explanation otherwise); add-to-calendar (.ics download); recording-consent
   + conduct line shown at RSVP (plain, vault-toned); my events (upcoming + past with
   attendance); event pass (member name, WAIME number, QR of the check-in code).
3. Admin: event list (state chips, counts); create/edit form; publish + cancel + postpone via
   propose-then-confirm with audit (cancel/postpone notifies every registered member in-app);
   registrations view per event (registered/waitlisted/attended counts, list); CHECK-IN view:
   search by name/code, mark attended / no-show, idempotent, producer-marked per the vault
   (attendance_finalized closes the event); post-event recording/materials links.
4. NOT in this slice (recorded deferrals per the vault's own phasing): host workspaces +
   guest-host accounts (Phase 2 of workshops), scheduled email reminders (Resend budget; when
   Resend Pro lands), event-participation certificates (approve-first weekly batch machinery,
   own slice), contribution-ledger points (recognition engine slice).

### B. Opportunities (vault: Scholarship & Opportunity Workflow, PRD Phase 3 §7.4)
5. Schema: `opportunities` (title, partner_name optional, type competitive|single_winner|
   evergreen, description, what_to_submit optional, eligibility_note, audience women_only|
   open [default women_only; allies excluded when women_only - dated ruling below], deadline
   + deadline label "11:59 PM GST" convention, anchor_event_id optional, state draft|open|
   closed|decided, evergreen "how to claim" text instead of applications).
   `opportunityApplications` (opportunity_id, member_id UNIQUE per pair, statement/note,
   state received|shortlisted|won|lost|withdrawn, result_note, timestamps).
6. Member: board (open opportunities the member is ELIGIBLE for, with plain explanations;
   minors and restricted_unknown NEVER see adult opportunities - server-side); apply =
   confirm-what-we-have (profile summary shown) + statement; automatic acknowledgement
   (in-app notification + application row); my applications with honest states; every
   applicant gets a result when recorded (in-app; email deferred). One application per member
   per opportunity; late applications refused politely at the server; evergreen listings show
   the claim path and take no applications.
7. Admin: list; intake/edit form; publish + close via propose-confirm + audit; auto-close at
   deadline (cron, timezone-aware); applications per opportunity (shortlist mark, record
   result won/lost with note via propose-confirm; recording a result notifies the applicant
   and every non-winner gets the kind "lost" notification per the vault's
   everyone-gets-an-answer rule).
8. Dated ruling (2026-07-06, recorded here; flagged for Issam): the vault is contradictory on
   whether applying requires Active standing (PRD §8) while applying is itself a qualifying
   action (Recognition Thresholds Rung 2). This slice gates APPLYING on: active lifecycle +
   profile complete + lane eligibility. Standing Active Member+ gates priority RSVP and
   directory only. If Issam rules otherwise, one server predicate changes.

### C. Standing (vault: Recognition Thresholds Rung 1-2; the rest of the engine is later)
9. `members.standing` member|active_member|ambassador|leadership_circle (default member) +
   append-only `standingHistory`. The Rung-2 AUTOMATIC binary gate ships: profile complete
   AND >=1 qualifying action (attended an event; applied to an opportunity) promotes member ->
   active_member (audited, notified, plain-language explanation). Active Member unlocks
   directory listing (if opted in) and priority-window RSVP. Ambassador/Leadership are
   DISPLAYED on the ladder with plain words but not attainable this slice (nomination engine
   + config thresholds are the recognition slice); no auto-nomination, no admin grant.
10. Member "My membership" page: membership summary (status, number, joined, certificate) +
    the standing ladder in plain words with her position and the honest next step.

### D. Directory (vault: PRD §7.7 canonical rule, Field Spec tiers)
11. Member-only directory: listed = directory toggle ON + standing active_member+ + lane
    standard|ally + lifecycle active. Minors/restricted NEVER appear. Directory-tier fields
    only (name, photo, headline, country, career stage, function/role, sectors, looking_for;
    never gender/DOB/email/mobile). Search by name + filters (country, career stage, sector).
    Enforced server-side at query time.

### E. Notifications (vault: PRD §7.8 P0, Stage 0 §4.6)
12. `notifications` (member_id, type, payload {title, body, href}, read_at, channel in_app,
    created_at). Written on: RSVP confirmed, waitlist promotion, event cancelled/postponed,
    application received, application result, certificate issued, standing change. Portal
    bell + notification center (unread count, mark all read). Email channel: recorded
    deferral (send caps; when Resend Pro lands).

### F. Members admin (vault: Stage 0 §3/§6/§7, Admin Approach)
13. Members list: count strip, lifecycle filter chips with counts, search (name/email),
    paginated table (member cell, lifecycle chip, lane, standing, country, joined, profile
    completeness bar, arrow to detail). NO bulk actions, NO export (export = the gated
    DataRequest path only).
14. Member detail: header (name, number, joined, source) + sections: status card (lifecycle +
    standing + lane in plain words), profile (read-only field-spec groups), engagement
    (her registrations + applications + recent audit rows for this member), certificates
    (list + super-admin revoke / re-issue correction per the decided supersedes chain),
    consents summary, admin notes (`adminNotes` table, author + time), contact behind a
    per-member AUDITED reveal (the claim-queue precedent). Actions: status change via
    propose-confirm with reason + audit, legal transitions only (active<->dormant,
    active|dormant->suspended, suspended->active); erasure stays in the data-requests queue.
15. Certificates admin view: all certificates (status chips valid/superseded/revoked, search),
    revoke-with-reason + re-issue-correction (supersedes chain, both archived, audited),
    SUPER-ADMIN only, propose-confirm.

### G. Partners admin (vault: Corporate Membership handoff, Money Mechanism, Stage 0 §4.6)
16. `partners` (name, tier supporter|partner|champion, status prospect|active|lapsed|declined,
    contact name/email, website, mou_signed_on, term months [default 12], committed_value
    text, deliverables array {label, status committed|in_progress|delivered|part_delivered},
    seal granted|withdrawn|none, logo storage, show_publicly default false, notes). Admin
    list + detail + create/edit + deliverable status updates + seal actions, all
    propose-confirm + audited. Outcome-led framing, MOU language, no payments, no binding
    contracts, no tax pitch. NO corporate-facing surface ships (self-serve Partner Portal is
    the vault's own Phase 4/5 item; record shapes stay compatible).

### H. Admin overview + reports (vault: Measurement & Impact Metrics, PRD §9/§13)
17. Overview v2: greeting + date + narrative summary line computed from real counts; KPI
    tiles (waiting work, active members, upcoming events, open opportunities) with attention
    tones; task inbox (every queue + pending check-ins + closing-soon opportunities, ranked);
    quick actions; event-floor counter (events delivered this year vs the 12/12 monthly
    floor); audit peek.
18. Reports view: sanctioned aggregates only - activation funnel (registered vs claimed vs
    active, integrity rule verbatim honoured), pipeline opt-in count, opportunities posted vs
    applications, events delivered + attendance totals, members by country/career stage
    (aggregates, no individuals). No export buttons.

### I. Shells and design language
19. Both consoles get the mockup-grade workspace shell on our tokens: dark navy sidebar
    (brand block, mono group labels, count badges, active accent item, identity block at
    bottom), topbar with breadcrumb/search where useful, page headers (eyebrow + display h1 +
    sub + ghost-then-primary action cluster), KPI tiles with washes, APanel-style section
    cards, dense data tables with filter bars, tabbed detail pages, modal-grade
    propose-confirm. Portal keeps hero warmth on Home; app pages use the workspace idiom.
    All panel.css: logical properties, AA, reduced-motion, hover:hover, gold recognition-only.
20. Youth/waiting/held/claim/no-member states preserved exactly; youth dashboard additionally
    shows youth-audience events only when any exist (none at launch is an honest empty state,
    not "coming soon").

### J. Proof (Gate 5)
21. tsc + astro check clean; vitest suites for EVERY new domain (lane gating, waitlist
    promotion + audit, priority window, one-application rule, auto-close, standing promotion,
    directory rule, status transitions, certificate supersede chain, notifications writes,
    deny-by-default on every admin query/mutation); full e2e suite green + new signed-out
    shell e2e; build green.
22. Design review (Gate 3) + Codex review (Gate 4, `codex-review.sh panel-experience`) pass;
    functions deployed to the DEV deployment only; demo ready for Issam.

## Recorded deferrals (vault-phased, not "coming soon" tiles - simply absent)
Host workspaces/guest hosts; email channel for notifications + scheduled reminders;
event-participation certificate batches; contribution ledger + Ambassador engine + Config
rows (recognition slice); resources/contribution two-rail system; mentorship; volunteers;
support tickets (email is the decided channel; Help page states it plainly); ActivityLog
(§4.6, next recorded slice; DELIVERED 2026-07-07 as specs/activity-log.spec.md on this
branch); PlacementLog; partner-facing portal.

## Dated rulings (2026-07-07, Gate 4 rounds 2-4; flagged for Issam's ratification)
- **Youth lane is TWO-WAY:** adult lanes neither see nor book `audience_lane=youth`
  events. The editor copy promised it; the server now enforces it.
- **restricted_unknown sees NO events at all** (round-4 required fix): an unconfirmed
  age belongs in neither an adult session nor an under-18 one, so the lane is locked out
  of event listing, detail and RSVP until the date of birth is confirmed (Stage 0 safety
  default). The portal words the lock honestly and points at support@waiorg.me.
- **Certificate-issued notification lives in the shared issuer** (round-4 required fix):
  every issuance path - activation, migrated claim, guardian confirmation, the fallback
  mutation - notifies exactly once, past the idempotency return.
- **Audience immutability:** an event's `audience_lane` freezes once it leaves draft,
  and an opportunity's `audience` freezes once it opens - members book/apply under an
  eligibility promise, so changing the pool means cancel/close and create anew. Same-value
  edits stay free.
- **Winner eligibility re-check:** recording "won" re-validates the applicant against the
  listing's CURRENT lane/audience rules (covers records corrected to minor/restricted
  after applying); "lost" always flows - everyone gets an answer.
- **Own application history stays visible whatever the member's current lane:**
  `myApplications` returns HER OWN applications (titles she already knows and results she
  is owed). A member corrected to minor/restricted keeps her history; the board, detail
  pages and new applications stay lane-refused server-side. Hiding a member's own past
  actions from her would be dishonest and would break everyone-gets-an-answer.
- **Directory carries no bio** (round-2 required fix): migrated members' `legacy_bio` is
  years-old text never re-reviewed; the vault field-spec tier table reads differently and
  the conflict is flagged for Issam. If ruled back in, bio returns only for members who
  edited it after claiming.
- **admin vs super_admin split** (round-2 required fix): `ADMIN_EMAILS` (Mervat + backup)
  gates the console and queues; certificate revoke/re-issue stay `SUPER_ADMIN_EMAILS`
  only. Owner action: set `ADMIN_EMAILS` on each deployment; empty means supers only.

## Sources
Workshop System (Design) · Event Cadence (Decision) · Scholarship & Opportunity Workflow
(Design) · PRD Phase 3 §7-§10 · PRD Phase 2-3 §4/§9/§11/§13 · Stage 0 §3-§10 · Recognition
Thresholds (Decision) · Under-18 Safeguards (Decision) · Member Profile Field Spec ·
Corporate Membership - Decision & Handoff · Corporate Money Mechanism (Decision) ·
Certificates In-House Engine (Decision) + Certificate Design & Eligibility Rules ·
Measurement & Impact Metrics (Decision) · Data Export, Backup & Retention (Decision) ·
Admin Approach - Agent-Operated · Admin Roles (Decision) · Design Source Brief (Reference) ·
mockup extraction reports (session scratchpad, 2026-07-06)
