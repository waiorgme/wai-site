import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { EmptyState, PageHeader, SearchInput } from "../../panel/kit";
import { initialsOf } from "../format";

// The member directory (spec D11). The server enforces the canonical listing
// rule and the under-18 lock at query time; this view only searches and
// filters the rows it was allowed to see (all client-side - the list is
// small and the privacy rule already ran on the server). No contact details
// exist anywhere in the payload, and the header says so honestly.

type DirectoryResult = ReturnType<typeof useQuery<typeof api.directory.listDirectory>>;
type DirectoryRow = NonNullable<DirectoryResult>["rows"][number];

export function DirectoryView() {
  const result: DirectoryResult = useQuery(api.directory.listDirectory, {});
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [stage, setStage] = useState("");
  const [sector, setSector] = useState("");

  const rows = useMemo(() => result?.rows ?? [], [result]);

  const countries = useMemo(
    () => facet(rows.map((r) => r.country_of_residence)),
    [rows],
  );
  const stages = useMemo(
    () => facet(rows.map((r) => r.career_stage_answer)),
    [rows],
  );
  const sectors = useMemo(() => facet(rows.flatMap((r) => r.sectors)), [rows]);

  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (q === "" ||
        r.name.toLowerCase().includes(q) ||
        (r.headline ?? "").toLowerCase().includes(q)) &&
      (country === "" || r.country_of_residence === country) &&
      (stage === "" || r.career_stage_answer === stage) &&
      (sector === "" || r.sectors.includes(sector)),
  );

  const header = (
    <PageHeader
      eyebrow="Directory"
      title="Member directory"
      sub="Members who chose to be listed. No contact details are shown - connection happens at events for now. Want to be found? Turn it on in Your choices."
    />
  );

  if (result === undefined) {
    return (
      <>
        {header}
        <p className="pn-meta">Loading…</p>
      </>
    );
  }
  if (result === null) {
    return (
      <>
        {header}
        <p className="pn-error">
          We couldn't load the directory. Refresh the page to try again.
        </p>
      </>
    );
  }
  if (result.locked) {
    return (
      <>
        {header}
        <EmptyState
          eyebrow="Directory"
          message="The member directory opens when you turn 18. Everything else in the portal is already yours."
        />
      </>
    );
  }

  return (
    <>
      {header}

      <div className="pn-filterbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by name or headline"
          label="Search the directory"
        />
        <span className="sp" />
        <FacetSelect
          label="Country"
          value={country}
          onChange={setCountry}
          options={countries}
          allLabel="All countries"
        />
        <FacetSelect
          label="Career stage"
          value={stage}
          onChange={setStage}
          options={stages}
          allLabel="All stages"
        />
        <FacetSelect
          label="Sector"
          value={sector}
          onChange={setSector}
          options={sectors}
          allLabel="All sectors"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          eyebrow="Directory"
          message="No one is listed yet. Members appear here when they choose to be found - you could be the first."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          eyebrow="Directory"
          message="No members match this yet - try clearing a filter or shortening the search."
        />
      ) : (
        <div className="pn-dir-grid">
          {visible.map((row, i) => (
            <MemberCard key={`${row.name}-${i}`} row={row} />
          ))}
        </div>
      )}
    </>
  );
}

function MemberCard({ row }: { row: DirectoryRow }) {
  return (
    <article className="pn-dir-card">
      <div className="head">
        {row.photo_url !== null ? (
          <img className="pic" src={row.photo_url} alt="" />
        ) : (
          <span className="pn-initials pn-initials--lg">
            {initialsOf(row.name)}
          </span>
        )}
        <div>
          <p className="pn-name">{row.name}</p>
          {row.headline !== null && row.headline !== "" && (
            <p className="pn-meta">{row.headline}</p>
          )}
        </div>
      </div>
      <p className="pn-meta">
        {[
          row.country_of_residence,
          row.career_stage_answer,
          [row.function_area, row.role].filter(Boolean).join(" · "),
        ]
          .filter((part) => part !== null && part !== "")
          .join(" · ")}
      </p>
      {row.sectors.length > 0 && (
        <div className="pn-chips">
          {row.sectors.map((s) => (
            <span className="pn-tag" key={s}>
              {s}
            </span>
          ))}
        </div>
      )}
      {row.looking_for.length > 0 && (
        <div className="pn-chips">
          {row.looking_for.map((s) => (
            <span className="pn-tag pn-tag--info" key={s}>
              {s}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function FacetSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <select
      className="pn-input pn-facet"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    >
      <option value="">{allLabel}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

const facet = (values: Array<string | null>): string[] =>
  [...new Set(values.filter((v): v is string => v !== null && v !== ""))].sort(
    (a, b) => a.localeCompare(b),
  );
