import { describe, expect, it } from "vitest";
import { evaluateMemberLane } from "../../convex/lib/memberLane";

const NOW = Date.UTC(2026, 6, 2, 12);

describe("evaluateMemberLane (§5, the single server-side source of truth)", () => {
  it("no DOB or unknown confidence is restricted_unknown", () => {
    expect(
      evaluateMemberLane(
        { gender: "female", date_of_birth: undefined, age_confidence: "unknown" },
        NOW,
      ),
    ).toBe("restricted_unknown");
    expect(
      evaluateMemberLane(
        { gender: "female", date_of_birth: "1990-01-01", age_confidence: "unknown" },
        NOW,
      ),
    ).toBe("restricted_unknown");
  });

  it("a minor is always minor, regardless of gender (order matters)", () => {
    expect(
      evaluateMemberLane(
        { gender: "female", date_of_birth: "2010-01-01", age_confidence: "declared" },
        NOW,
      ),
    ).toBe("minor");
    expect(
      evaluateMemberLane(
        { gender: "male", date_of_birth: "2010-01-01", age_confidence: "declared" },
        NOW,
      ),
    ).toBe("minor");
  });

  it("an adult male is ally; an adult female is standard", () => {
    expect(
      evaluateMemberLane(
        { gender: "male", date_of_birth: "1990-01-01", age_confidence: "declared" },
        NOW,
      ),
    ).toBe("ally");
    expect(
      evaluateMemberLane(
        { gender: "female", date_of_birth: "1990-01-01", age_confidence: "confirmed" },
        NOW,
      ),
    ).toBe("standard");
  });

  it("the day before the 18th birthday is still minor", () => {
    expect(
      evaluateMemberLane(
        { gender: "female", date_of_birth: "2008-07-03", age_confidence: "declared" },
        NOW,
      ),
    ).toBe("minor");
    expect(
      evaluateMemberLane(
        { gender: "female", date_of_birth: "2008-07-02", age_confidence: "declared" },
        NOW,
      ),
    ).toBe("standard");
  });
});
