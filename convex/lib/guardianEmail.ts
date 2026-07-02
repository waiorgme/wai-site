// The guardian confirmation email. Copy is VERBATIM from the vault:
// 01 Organization/01 Under-18 Launch Copy (Drafts) §1 ("The guardian then
// receives this email"), rendered to plain text like the magic-link email.
// The ONLY substitutions are the vault's own placeholders: [Guardian name],
// [Applicant first name], [she/they] rendered as "she" (the vault's member
// convention), the two bracketed page links resolved to their URLs, and the
// consent button rendered as its sentence plus the tokened link ("click
// below" stays true: the link is directly below). No em dashes.

import { SITE } from "../../site.config.mjs";

export const GUARDIAN_EMAIL_SUBJECT =
  "Please confirm, your child would like to join Women in Aviation Middle East";

export const renderGuardianEmail = ({
  guardianName,
  applicantFirstName,
  confirmUrl,
}: {
  guardianName: string;
  applicantFirstName: string;
  confirmUrl: string;
}): string =>
  `Dear ${guardianName},

${applicantFirstName} has asked to join Women in Aviation Middle East (WAI-ME), a community that encourages women and girls in aviation. Because she is under 18, we ask for your consent before activating the account.

What joining means for a member under 18:

- It's free, and ${applicantFirstName} joins a protected youth lane designed for under-18s.
- We collect only the information we need, and we never share a young member's details with companies or partners.
- Under-18 members are kept out of adult features, one-to-one mentoring, the adult events calendar, the talent pipeline, the member directory, and private messaging with adults. Any activity offered to a young member is reviewed and approved individually by our President.
- What ${applicantFirstName} receives is access to Women in Aviation International's Aviation for Girls program, aviation learning, role-model stories, and youth events.
- At 18, the account moves to full membership.

You can read how we protect young members here: ${SITE}/safeguarding/ and how we handle data here: ${SITE}/privacy/

To give your consent, please click below. If you'd prefer not to, simply ignore this email and the account won't be activated.

Yes, I confirm I'm ${applicantFirstName}'s parent or guardian and consent to this membership:
${confirmUrl}

Questions or concerns at any time: support@waiorg.me.

With thanks,
Women in Aviation Middle East
`;
