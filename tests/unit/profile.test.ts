import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  isProfileComplete,
  validateProfileFields,
} from "../../convex/lib/profile";

const PHOTO = "photo" as Id<"_storage">;

describe("validateProfileFields (boundary validation)", () => {
  it("accepts a full valid profile", () => {
    expect(
      validateProfileFields({
        career_stage_answer: "Working in aviation",
        function_area: "Flight Operations",
        role: "Pilot (Captain)",
        second_function_area: "Training & Academia",
        second_role: "Instructor / Examiner",
        years_in_aviation: "8 to 15",
        sectors: ["Airline", "Training / Academia"],
        certifications: ["ATPL", "Type Rating"],
        highest_qualification: "Bachelor's",
        looking_for: ["Networking", "Offer mentorship (as mentor)"],
      }),
    ).toBeNull();
  });

  it("rejects unknown picklist values, naming the field", () => {
    expect(validateProfileFields({ career_stage_answer: "CEO" })).toBe(
      "career_stage_answer",
    );
    expect(validateProfileFields({ function_area: "Space Tourism" })).toBe(
      "function_area",
    );
    expect(validateProfileFields({ years_in_aviation: "50" })).toBe(
      "years_in_aviation",
    );
    expect(validateProfileFields({ highest_qualification: "Bootcamp" })).toBe(
      "highest_qualification",
    );
  });

  it("requires the role to belong to the chosen function area", () => {
    expect(
      validateProfileFields({
        function_area: "Aviation Medicine",
        role: "Pilot (Captain)",
      }),
    ).toBe("role");
    expect(
      validateProfileFields({
        function_area: "Aviation Medicine",
        role: "Aeromedical Examiner",
      }),
    ).toBeNull();
  });

  it("a role without its area is invalid; Other / Aspiring takes free text", () => {
    expect(validateProfileFields({ role: "Pilot (Captain)" })).toBe("role");
    expect(
      validateProfileFields({
        function_area: "Other / Aspiring",
        role: "Future astronaut",
      }),
    ).toBeNull();
  });

  it("validates multi-select arrays element by element", () => {
    expect(validateProfileFields({ sectors: ["Airline", "Bakery"] })).toBe(
      "sectors",
    );
    expect(
      validateProfileFields({ certifications: ["ATPL", "Karate black belt"] }),
    ).toBe("certifications");
    expect(validateProfileFields({ looking_for: ["World peace"] })).toBe(
      "looking_for",
    );
  });

  it("empty string means cleared and always passes", () => {
    expect(
      validateProfileFields({
        career_stage_answer: "",
        function_area: "",
        role: "",
        years_in_aviation: "",
        highest_qualification: "",
      }),
    ).toBeNull();
  });
});

describe("isProfileComplete (kept low and reachable)", () => {
  const complete = {
    name: "Amal",
    photo_storage_id: PHOTO,
    career_stage_answer: "Studying / cadet",
    function_area: "Flight Operations",
    country_of_residence: "UAE",
  };

  it("true with name + photo + stage + area + country", () => {
    expect(isProfileComplete(complete)).toBe(true);
  });

  it("false when any of the five is missing", () => {
    expect(isProfileComplete({ ...complete, photo_storage_id: undefined })).toBe(false);
    expect(isProfileComplete({ ...complete, career_stage_answer: "" })).toBe(false);
    expect(isProfileComplete({ ...complete, function_area: undefined })).toBe(false);
    expect(isProfileComplete({ ...complete, country_of_residence: "" })).toBe(false);
  });
});
