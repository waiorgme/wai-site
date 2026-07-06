import { PageHeader } from "../../panel/kit";
import { YourData } from "../YourData";

// "Your data" as a shell page: the existing data-rights component rendered
// unchanged (its own copy explains the export and erasure requests and the
// human review behind them).

export function YourDataView() {
  return (
    <>
      <PageHeader
        eyebrow="Your data"
        title="Your data"
        sub="It's yours. Ask for a copy, or ask us to delete it - a person reviews every request."
      />
      <div className="pn-card">
        <YourData compact />
      </div>
    </>
  );
}
