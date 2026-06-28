import { ageInYears } from "./age";

// §5 The member-lane evaluator. The single server-side source of truth for
// every restricted action. No UI may be the only thing enforcing a restriction.
// Order matters: a minor (male or female) is always `minor`, never `ally`.

export type MemberLane = "standard" | "minor" | "ally" | "restricted_unknown";

type LaneInput = {
  gender: "female" | "male";
  date_of_birth: string | undefined;
  age_confidence: "confirmed" | "declared" | "unknown";
};

export const evaluateMemberLane = (
  member: LaneInput,
  now: number,
): MemberLane => {
  if (!member.date_of_birth || member.age_confidence === "unknown") {
    return "restricted_unknown";
  }
  if (ageInYears(member.date_of_birth, now) < 18) {
    return "minor";
  }
  if (member.gender === "male") {
    return "ally";
  }
  return "standard";
};
