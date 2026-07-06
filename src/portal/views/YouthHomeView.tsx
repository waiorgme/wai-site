import { YourData } from "../YourData";
import { muted, primaryBtn } from "../ui";
import {
  CertificateSection,
  type CertsView,
  type MemberView,
  type MembershipCertView,
} from "./CertificateSection";
import { standingWord, type Standing } from "../format";

// The youth Home (Under-18 Launch Copy §2, copy VERBATIM from round 1's
// youth dashboard): her certificate plus the Aviation for Girls home base.
// Nothing the protected experience excludes (mentoring, directory, pipeline,
// settings toggles) is rendered; the servers refuse them too.

export function YouthHomeView({
  me,
  certs,
  membershipCert,
  standing,
}: {
  me: NonNullable<MemberView>;
  certs: CertsView;
  membershipCert: MembershipCertView;
  // Real standing (a minor can lawfully reach Active Member; the vault caps
  // her there), so Home never disagrees with the sidebar or My membership.
  standing: Standing;
}) {
  return (
    <>
      <section className="pn-hero-card">
        <p className="pn-eyebrow">Member portal</p>
        <h1 className="pn-h1">Welcome to Women in Aviation Middle East.</h1>
        <p className={muted}>
          You're part of a regional community of women and girls who love
          aviation, and your journey starts here.
        </p>
        <div className="pn-glass">
          <div className="cell">
            <span className="label">Name</span>
            <span className="value">{me.name}</span>
          </div>
          <div className="cell">
            <span className="label">Standing</span>
            <span className="value">{standingWord(standing)}</span>
          </div>
          {membershipCert !== null && (
            <div className="cell">
              <span className="label">Membership number</span>
              <span className="value">WAIME-{membershipCert.membership_number}</span>
            </div>
          )}
          {issuedYearOf(membershipCert) !== null && (
            <div className="cell">
              <span className="label">Certificate issued</span>
              <span className="value">{issuedYearOf(membershipCert)}</span>
            </div>
          )}
        </div>
      </section>

      <CertificateSection
        me={me}
        certs={certs}
        isActive
        membershipCert={membershipCert}
      />

      <section className="pn-card">
        <span className="pn-eyebrow on-paper">Your home base</span>
        <p className={muted}>
          {"As a member under 18, your home base is "}
          <strong>Aviation for Girls</strong>
          {", the youth program run by our parent organisation, Women in Aviation International. It's made for you, and it's free:"}
        </p>
        <ul
          className={muted}
          style={{ paddingInlineStart: 20, display: "grid", gap: 6 }}
        >
          <li>
            <strong>The Aviation for Girls app:</strong>{" "}
            aviation content, activities, and stories from women already
            flying, building, and leading.
          </li>
          <li>
            <strong>AFG Engage:</strong>{" "}
            online lessons that introduce aviation and aerospace careers,
            step by step.
          </li>
          <li>
            <strong>AFG Connect News</strong>
            {" and the annual "}
            <strong>Aviation for Girls magazine</strong>
            {", stories, opportunities, and people to look up to."}
          </li>
          <li>
            <strong>Girls in Aviation Day:</strong>{" "}
            a global event you can take part in.
          </li>
        </ul>
        <div className="pn-actions">
          <a
            href="https://www.wai.org/youth-education"
            target="_blank"
            rel="noopener"
            className={primaryBtn}
          >
            Explore Aviation for Girls →
          </a>
        </div>
        <p className={muted}>
          When you turn 18, your WAI-ME membership opens up fully, mentoring,
          events, opportunities, and the wider network. Until then, this is
          your runway. We're glad you're here.
        </p>
      </section>

      {/* Data rights apply to under-18 members too (they are not behind the
          adult-only choices panel a minor never sees). */}
      <section className="pn-card">
        <YourData compact />
      </section>
    </>
  );
}

// Year of issue, read from the certificate's own date label ("12 June 2026").
// Labelled "Certificate issued", never "member since" (round-1 Hero rule).
const issuedYearOf = (cert: MembershipCertView): string | null =>
  cert?.issued_date_label.match(/\b\d{4}\b/)?.[0] ?? null;
