import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  CAREER_STAGES,
  CERTIFICATIONS,
  FUNCTION_AREA_NAMES,
  FUNCTION_AREAS,
  LOOKING_FOR,
  QUALIFICATIONS,
  SECTORS,
  YEARS_BANDS,
} from "../../convex/lib/profile";
import {
  chip,
  chipActive,
  errorText,
  hint,
  input,
  label,
  linkBtn,
  muted,
  primaryBtn,
  sectionTitle,
  textarea,
} from "./ui";

// The editable form mirrors getMyProfile (strings + arrays only; the photo is
// handled separately via an upload URL).
type Form = {
  headline: string;
  bio: string;
  nationality: string;
  country_of_residence: string;
  career_stage_answer: string;
  function_area: string;
  role: string;
  second_function_area: string;
  second_role: string;
  years_in_aviation: string;
  current_job_title: string;
  current_employer: string;
  sectors: string[];
  certifications: string[];
  certifications_other: string;
  highest_qualification: string;
  field_of_study: string;
  institution: string;
  looking_for: string[];
};

const EMPTY: Form = {
  headline: "",
  bio: "",
  nationality: "",
  country_of_residence: "",
  career_stage_answer: "",
  function_area: "",
  role: "",
  second_function_area: "",
  second_role: "",
  years_in_aviation: "",
  current_job_title: "",
  current_employer: "",
  sectors: [],
  certifications: [],
  certifications_other: "",
  highest_qualification: "",
  field_of_study: "",
  institution: "",
  looking_for: [],
};

export function ProfileEditor({
  onClose,
  hideMentorship = false,
}: {
  onClose: () => void;
  // Safeguarding: mentorship options are never offered to members under 18
  // (the server strips them too).
  hideMentorship?: boolean;
}) {
  const profile = useQuery(api.members.getMyProfile);
  const updateProfile = useMutation(api.members.updateProfile);
  const generateUploadUrl = useMutation(api.members.generatePhotoUploadUrl);

  const [form, setForm] = useState<Form>(EMPTY);
  const [seeded, setSeeded] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [newPhotoId, setNewPhotoId] = useState<Id<"_storage"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Seed the form once the profile loads.
  useEffect(() => {
    if (profile && !seeded) {
      const { photo_url, profile_complete, name, ...fields } = profile;
      setForm({ ...EMPTY, ...fields });
      setPhotoPreview(photo_url);
      setSeeded(true);
    }
  }, [profile, seeded]);

  if (profile === undefined) {
    return <p style={muted}>Loading your profile…</p>;
  }
  if (profile === null) {
    return (
      <p style={muted}>
        There's no member profile linked to this email yet.
      </p>
    );
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const toggle = (key: "sectors" | "certifications" | "looking_for", value: string) => {
    setForm((f) => {
      const current = f[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...f, [key]: next };
    });
    setSaved(false);
  };

  const onPickPhoto = async (file: File) => {
    // Friendly early check; the server enforces the same rule (SEC-4).
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Please choose a JPG, PNG or WebP photo under 5 MB.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      setNewPhotoId(storageId);
      setPhotoPreview(URL.createObjectURL(file));
      setSaved(false);
    } catch {
      setError("That photo couldn't be uploaded. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const onSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await updateProfile({
        ...form,
        ...(newPhotoId ? { photo_storage_id: newPhotoId } : {}),
      });
      if (result.ok === false) {
        setError(
          result.error === "invalid:photo"
            ? "Please choose a JPG, PNG or WebP photo under 5 MB."
            : "Some details couldn't be saved. Please check and try again.",
        );
        return;
      }
      setSaved(true);
    } catch {
      setError("Something went wrong saving your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const roles = FUNCTION_AREAS[form.function_area] ?? [];
  const secondRoles = FUNCTION_AREAS[form.second_function_area] ?? [];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section title="About you" />
      <Photo
        preview={photoPreview}
        uploading={uploading}
        onPick={onPickPhoto}
        fileRef={fileRef}
      />
      <Field
        labelText="Headline"
        tip="One line about you, like 'Aspiring pilot' or 'Aircraft maintenance engineer.' It's the first thing people see."
      >
        <input
          style={input}
          value={form.headline}
          onChange={(e) => set("headline", e.target.value)}
          placeholder="Aspiring pilot"
        />
      </Field>
      <Field labelText="About">
        <textarea
          style={textarea}
          value={form.bio}
          onChange={(e) => set("bio", e.target.value)}
          placeholder="A short paragraph about you and your journey in aviation."
        />
      </Field>
      <Two>
        <Field labelText="Nationality">
          <input
            style={input}
            value={form.nationality}
            onChange={(e) => set("nationality", e.target.value)}
          />
        </Field>
        <Field labelText="Country of residence">
          <input
            style={input}
            value={form.country_of_residence}
            onChange={(e) => set("country_of_residence", e.target.value)}
          />
        </Field>
      </Two>

      <Section title="Where you are in aviation" />
      <Field
        labelText="Career stage"
        tip="Just tell us where you are right now - there's no wrong answer, and it changes as you grow."
      >
        <Select
          value={form.career_stage_answer}
          onChange={(v) => set("career_stage_answer", v)}
          options={CAREER_STAGES}
          placeholder="Select one…"
        />
      </Field>
      <Field
        labelText="Function area"
        tip="The part of aviation you work in, or the part you're aiming for if you're just starting. Not sure yet? Choose 'Other / Aspiring.'"
      >
        <Select
          value={form.function_area}
          onChange={(v) => {
            set("function_area", v);
            set("role", "");
          }}
          options={FUNCTION_AREA_NAMES}
          placeholder="Select an area…"
        />
      </Field>
      {form.function_area !== "" && form.function_area !== "Other / Aspiring" && (
        <Field
          labelText="Role"
          tip="Your specific role within that area. Pick the closest one - you can change it anytime."
        >
          <Select
            value={form.role}
            onChange={(v) => set("role", v)}
            options={roles}
            placeholder="Select a role…"
          />
        </Field>
      )}
      {form.function_area !== "" && (
        <Field
          labelText="Second specialisation (optional)"
          tip="If you work across more than one area, add a second here."
        >
          <Select
            value={form.second_function_area}
            onChange={(v) => {
              set("second_function_area", v);
              set("second_role", "");
            }}
            options={FUNCTION_AREA_NAMES}
            placeholder="Select an area…"
          />
        </Field>
      )}
      {form.second_function_area !== "" &&
        form.second_function_area !== "Other / Aspiring" && (
          <Field labelText="Second role">
            <Select
              value={form.second_role}
              onChange={(v) => set("second_role", v)}
              options={secondRoles}
              placeholder="Select a role…"
            />
          </Field>
        )}

      <Section title="Your experience" />
      <Field
        labelText="Years in aviation"
        tip="Roughly how long you've worked in aviation. Brand new? Choose 'None yet' - that's completely fine here."
      >
        <Select
          value={form.years_in_aviation}
          onChange={(v) => set("years_in_aviation", v)}
          options={YEARS_BANDS}
          placeholder="Select…"
        />
      </Field>
      <Two>
        <Field labelText="Current job title">
          <input
            style={input}
            value={form.current_job_title}
            onChange={(e) => set("current_job_title", e.target.value)}
          />
        </Field>
        <Field labelText="Current employer">
          <input
            style={input}
            value={form.current_employer}
            onChange={(e) => set("current_employer", e.target.value)}
          />
        </Field>
      </Two>
      <Field
        labelText="Sectors"
        tip="The kind of place you've worked - an airline, an airport, a training school, and so on. Tick all that apply."
      >
        <Chips
          options={SECTORS}
          selected={form.sectors}
          onToggle={(v) => toggle("sectors", v)}
        />
      </Field>

      <Section title="Qualifications" />
      <Field
        labelText="Certifications & licences"
        tip="Official aviation qualifications or licences you hold. Don't have any yet? Leave it empty; many members start here."
      >
        <Chips
          options={CERTIFICATIONS}
          selected={form.certifications}
          onToggle={(v) => toggle("certifications", v)}
        />
      </Field>
      <Field labelText="Other certification (free text)">
        <input
          style={input}
          value={form.certifications_other}
          onChange={(e) => set("certifications_other", e.target.value)}
        />
      </Field>
      <Field
        labelText="Highest qualification"
        tip="Your highest level of education so far. This helps us match you to scholarships and training."
      >
        <Select
          value={form.highest_qualification}
          onChange={(v) => set("highest_qualification", v)}
          options={QUALIFICATIONS}
          placeholder="Select…"
        />
      </Field>
      <Two>
        <Field labelText="Field of study">
          <input
            style={input}
            value={form.field_of_study}
            onChange={(e) => set("field_of_study", e.target.value)}
          />
        </Field>
        <Field labelText="Institution">
          <input
            style={input}
            value={form.institution}
            onChange={(e) => set("institution", e.target.value)}
          />
        </Field>
      </Two>

      <Section title="What you're looking for" />
      <Field
        labelText="Looking for"
        tip={
          hideMentorship
            ? "What would help you most right now? Tick anything - a scholarship, an event, or meeting other women in aviation."
            : "What would help you most right now? Tick anything - a job, a scholarship, a mentor, or just meeting other women in aviation."
        }
      >
        <Chips
          options={
            hideMentorship
              ? LOOKING_FOR.filter((o) => !o.toLowerCase().includes("mentor"))
              : LOOKING_FOR
          }
          selected={form.looking_for}
          onToggle={(v) => toggle("looking_for", v)}
        />
      </Field>

      {error !== null && <p style={errorText}>{error}</p>}
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 4 }}>
        <button type="button" style={primaryBtn} disabled={busy} onClick={onSave}>
          {busy ? "Saving…" : "Save profile"}
        </button>
        <button type="button" style={linkBtn} onClick={onClose}>
          Back
        </button>
        {saved && (
          <span style={{ ...muted, color: "var(--sky)", fontSize: 13 }}>Saved ✓</span>
        )}
      </div>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <h2 style={sectionTitle}>{title}</h2>;
}

function Field({
  labelText,
  tip,
  children,
}: {
  labelText: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={label}>
      {labelText}
      {tip && <span style={hint}>{tip}</span>}
      {children}
    </label>
  );
}

function Two({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder: string;
}) {
  return (
    <select
      style={input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          style={selected.includes(o) ? chipActive : chip}
          aria-pressed={selected.includes(o)}
          onClick={() => onToggle(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Photo({
  preview,
  uploading,
  onPick,
  fileRef,
}: {
  preview: string | null;
  uploading: boolean;
  onPick: (file: File) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "var(--ink)",
          border: "1px solid rgba(207, 224, 245, 0.22)",
          overflow: "hidden",
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt="Profile"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ ...muted, fontSize: 11, opacity: 0.6 }}>No photo</span>
        )}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <button
          type="button"
          style={linkBtn}
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Uploading…" : preview ? "Change photo" : "Add a photo"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void onPick(file);
            }
          }}
        />
        <span style={hint}>A face for your profile. Shown in the members' directory if you join it.</span>
      </div>
    </div>
  );
}
