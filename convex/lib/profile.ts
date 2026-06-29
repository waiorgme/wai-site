// Profile option sets + completeness rule. Pure data/functions (no deployment
// needed), mirroring the build-ready field spec
// ([[02 Member Profile Field Spec (Talent Pipeline)]]). The updateProfile
// mutation validates incoming values against these at the boundary, so an
// unknown option can never be stored.

import type { Id } from "../_generated/dataModel";

// Group B, the five public career-stage options. Same set the Join form stores,
// so signup and the profile match exactly.
export const CAREER_STAGES = [
  "Dreaming of starting",
  "Studying / cadet",
  "Trying to break in",
  "Working in aviation",
  "Working in another field",
] as const;

// Group C, function area → its roles. "Other / Aspiring" takes any free text.
export const FUNCTION_AREAS: Record<string, readonly string[]> = {
  "Flight Operations": [
    "Pilot (Captain)",
    "Pilot (First Officer)",
    "Pilot (Cadet)",
    "Cabin Crew",
    "Flight Dispatcher / Operations Control",
  ],
  "Engineering & Maintenance": [
    "Aircraft Maintenance Engineer / Technician",
    "Aeronautical / Aerospace Engineer",
    "MRO / Quality",
  ],
  "Air Traffic Management": [
    "Air Traffic Controller",
    "Aeronautical Information / ANS",
  ],
  "Airport & Ground Operations": [
    "Airport Operations",
    "Ground Handling / Ramp",
    "Airside Safety",
  ],
  "Safety, Quality & Security": [
    "Safety Management",
    "Oversight & Inspection",
    "Aviation Security (AVSEC)",
  ],
  "Aviation Medicine": ["Aeromedical Examiner", "Aviation Nurse / Clinic"],
  "Regulatory & Government": [
    "Civil Aviation Authority / Regulator",
    "Policy & Standards",
  ],
  "Commercial & Corporate": [
    "Management / Leadership",
    "HR",
    "Marketing / Communications",
    "Sales / Commercial",
    "Finance",
    "IT / Digital",
  ],
  "Training & Academia": [
    "Instructor / Examiner",
    "University / Research",
    "Student",
  ],
  "Other / Aspiring": [],
};

export const FUNCTION_AREA_NAMES = Object.keys(FUNCTION_AREAS);
const FREE_ROLE_AREA = "Other / Aspiring";

// Group D, experience band.
export const YEARS_BANDS = [
  "None yet",
  "Under 1",
  "1 to 3",
  "4 to 7",
  "8 to 15",
  "15+",
] as const;

// Group D, sectors (multi-select).
export const SECTORS = [
  "Airline",
  "Airport",
  "ANSP",
  "MRO / Engineering",
  "Regulator / Government",
  "Training / Academia",
  "Business / General Aviation",
  "Ground Services",
  "Aerospace / OEM",
  "Cargo / Logistics",
  "Aviation Medicine",
  "Consulting / Other",
] as const;

// Group E, certifications picklist ("Other" is captured as free text separately).
export const CERTIFICATIONS = [
  "PPL",
  "CPL",
  "ATPL",
  "Type Rating",
  "Cabin Crew Attestation",
  "Aircraft Maintenance Licence (A&P / AME)",
  "Aeronautical / Aerospace Engineering degree",
  "Flight Dispatcher / FOO licence",
  "Air Traffic Controller licence",
  "IATA qualification",
  "Dangerous Goods (DG)",
  "Aviation Security (AVSEC)",
  "Aviation Medicine designation",
  "Aviation Management qualification",
] as const;

// Group F, highest qualification.
export const QUALIFICATIONS = [
  "High school",
  "Vocational",
  "Diploma",
  "Bachelor's",
  "Master's",
  "PhD",
] as const;

// Group G, what she's looking for (multi-select).
export const LOOKING_FOR = [
  "Jobs",
  "Internships",
  "Scholarships / training",
  "Mentorship (as mentee)",
  "Offer mentorship (as mentor)",
  "Networking",
  "Events / workshops",
  "Speaking opportunities",
] as const;

// The editable profile fields, all optional. Stored on the Member row.
export type ProfileFields = {
  headline?: string;
  bio?: string;
  photo_storage_id?: Id<"_storage">;
  nationality?: string;
  country_of_residence?: string;
  career_stage_answer?: string;
  function_area?: string;
  role?: string;
  second_function_area?: string;
  second_role?: string;
  years_in_aviation?: string;
  current_job_title?: string;
  current_employer?: string;
  sectors?: string[];
  certifications?: string[];
  certifications_other?: string;
  highest_qualification?: string;
  field_of_study?: string;
  institution?: string;
  looking_for?: string[];
};

const inSet = (value: string, set: readonly string[]): boolean =>
  set.includes(value);

const roleValidForArea = (area: string | undefined, role: string): boolean => {
  if (area === undefined) {
    return false;
  }
  if (area === FREE_ROLE_AREA) {
    return true;
  }
  return (FUNCTION_AREAS[area] ?? []).includes(role);
};

// Boundary validation. Returns an error string (the offending field) or null.
// Only non-empty picklist fields are constrained; "" means "cleared" and free-
// text fields pass through.
const set = (value: string | undefined): boolean =>
  value !== undefined && value !== "";

export const validateProfileFields = (
  fields: ProfileFields,
): string | null => {
  if (set(fields.career_stage_answer) && !inSet(fields.career_stage_answer!, CAREER_STAGES)) {
    return "career_stage_answer";
  }
  if (set(fields.function_area) && !inSet(fields.function_area!, FUNCTION_AREA_NAMES)) {
    return "function_area";
  }
  if (set(fields.role) && !roleValidForArea(fields.function_area, fields.role!)) {
    return "role";
  }
  if (set(fields.second_function_area) && !inSet(fields.second_function_area!, FUNCTION_AREA_NAMES)) {
    return "second_function_area";
  }
  if (set(fields.second_role) && !roleValidForArea(fields.second_function_area, fields.second_role!)) {
    return "second_role";
  }
  if (set(fields.years_in_aviation) && !inSet(fields.years_in_aviation!, YEARS_BANDS)) {
    return "years_in_aviation";
  }
  if (set(fields.highest_qualification) && !inSet(fields.highest_qualification!, QUALIFICATIONS)) {
    return "highest_qualification";
  }
  if (fields.sectors !== undefined && !fields.sectors.every((s) => inSet(s, SECTORS))) {
    return "sectors";
  }
  if (fields.certifications !== undefined && !fields.certifications.every((c) => inSet(c, CERTIFICATIONS))) {
    return "certifications";
  }
  if (fields.looking_for !== undefined && !fields.looking_for.every((l) => inSet(l, LOOKING_FOR))) {
    return "looking_for";
  }
  return null;
};

// "Profile complete" for the recognition engine. Kept low and reachable, per the
// field spec: name + photo + career stage + (specialisation or aiming field) +
// country. function_area covers both real and aspired specialisation.
export const isProfileComplete = (m: {
  name?: string;
  photo_storage_id?: Id<"_storage">;
  career_stage_answer?: string;
  function_area?: string;
  country_of_residence?: string;
}): boolean =>
  Boolean(
    m.name &&
      m.photo_storage_id &&
      m.career_stage_answer &&
      m.function_area &&
      m.country_of_residence,
  );
