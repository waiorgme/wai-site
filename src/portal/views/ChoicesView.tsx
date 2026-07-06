import { PageHeader } from "../../panel/kit";
import { Settings } from "../Settings";

// "Your choices": round 1's intro copy preserved, the existing Settings
// component rendered unchanged inside the shell (it keeps the pipeline
// hidden for the ally lane and the locked copy for under-18 accounts).

export function ChoicesView({ onDone }: { onDone: () => void }) {
  return (
    <>
      <PageHeader
        eyebrow="Your choices"
        title="Your choices"
        sub="Who can find you, and how. Both are off unless you turn them on, and you can change your mind anytime."
      />
      <div className="pn-card">
        <Settings onClose={onDone} />
      </div>
    </>
  );
}
