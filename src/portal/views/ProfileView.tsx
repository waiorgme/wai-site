import { PageHeader } from "../../panel/kit";
import { ProfileEditor } from "../ProfileEditor";

// The profile page: round 1's intro copy preserved, the existing editor
// rendered unchanged inside the shell. `notice` carries a one-line plain
// explanation when another view routed her here (e.g. an application that
// needs the profile basics first).

export function ProfileView({
  hideMentorship,
  notice,
  onDone,
}: {
  hideMentorship: boolean;
  notice?: string;
  onDone: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Profile"
        title="Your profile"
        sub="The more you add, the better we can match you to opportunities, events and people. Nothing is required, so add what you like, anytime."
      />
      {notice !== undefined && (
        <p className="pn-notice" role="status">
          {notice}
        </p>
      )}
      <div className="pn-card">
        <ProfileEditor onClose={onDone} hideMentorship={hideMentorship} />
      </div>
    </>
  );
}
