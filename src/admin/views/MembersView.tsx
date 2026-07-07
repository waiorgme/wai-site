import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { MemberListRow } from "../../../convex/admin/members";
import type { ChipOption, Column } from "../../panel/kit";
import {
  DataTable,
  EmptyState,
  FilterChips,
  PageHeader,
  PanelCard,
  ProgressBar,
  SearchInput,
} from "../../panel/kit";
import type { Go, Lifecycle } from "./shared";
import { dateStringLabel, initials, LANE_WORDS, LIFECYCLE_WORDS, lifecycleTagClass, STANDING_WORDS } from "./shared";

// Members list (panel-experience spec F13): a review surface, not a member
// browser. Rows never carry an email (server contract); search matches email
// on the server without ever returning it. NO bulk actions, NO export - export
// stays the gated data-request path.
//
// Chip note: the server filter is one lifecycle state at a time, so the chips
// are per-state (a grouped "Waiting" chip could not paginate honestly). The
// steady states always show; transient waiting/erasure states appear only
// while someone is actually in them.

const ALWAYS_CHIPS: ReadonlyArray<Lifecycle> = [
  "active",
  "dormant",
  "suspended",
  "archived",
];

const TRANSIENT_CHIPS: ReadonlyArray<Lifecycle> = [
  "email_unverified",
  "consent_pending",
  "pending_guardian",
  "claim_pending",
  "pending_review",
  "erasure_requested",
  "erasure_in_progress",
];

const COLUMNS: ReadonlyArray<Column> = [
  { key: "who", header: "Member" },
  { key: "lifecycle", header: "Status", width: "170px" },
  { key: "lane", header: "Membership type", width: "150px" },
  { key: "standing", header: "Standing", width: "130px" },
  { key: "country", header: "Country", width: "140px" },
  { key: "joined", header: "Joined", width: "110px" },
  { key: "completeness", header: "Profile", width: "120px" },
];

export function MembersView({ go }: { go: Go }) {
  const [filter, setFilter] = useState<"all" | Lifecycle>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Debounce the server search: the input stays live, the query refires only
  // after a typing pause, so the table does not flash on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const live = useQuery(api.admin.members.listMembers, {
    lifecycle: filter === "all" ? undefined : filter,
    search: search.trim() === "" ? undefined : search.trim(),
    page,
  });
  // Keep the last loaded rows on screen while a refinement loads.
  const [shown, setShown] = useState(live);
  if (live !== undefined && live !== shown) {
    setShown(live);
  }
  const result = live ?? shown;

  const chips: ChipOption[] = (() => {
    if (result === undefined) {
      return [{ key: "all", label: "All" }];
    }
    const counts = result.lifecycle_counts;
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const options: ChipOption[] = [{ key: "all", label: "All", count: total }];
    for (const state of ALWAYS_CHIPS) {
      options.push({
        key: state,
        label: LIFECYCLE_WORDS[state],
        count: counts[state] ?? 0,
      });
    }
    for (const state of TRANSIENT_CHIPS) {
      if ((counts[state] ?? 0) > 0 || filter === state) {
        options.push({
          key: state,
          label: LIFECYCLE_WORDS[state],
          count: counts[state] ?? 0,
        });
      }
    }
    return options;
  })();

  const renderCell = (row: MemberListRow, col: Column) => {
    switch (col.key) {
      case "who":
        return (
          <span className="pn-cell-id">
            <span className="pn-initials">{initials(row.name)}</span>
            <span className="pn-cell-2l">
              <span className="t">{row.name}</span>
            </span>
          </span>
        );
      case "lifecycle":
        return (
          <span className={lifecycleTagClass(row.lifecycle_state)}>
            {LIFECYCLE_WORDS[row.lifecycle_state]}
          </span>
        );
      case "lane":
        return LANE_WORDS[row.member_lane];
      case "standing":
        return STANDING_WORDS[row.standing];
      case "country":
        return row.country_of_residence ?? "Not given";
      case "joined":
        return <span className="pn-cell-date">{dateStringLabel(row.joined)}</span>;
      case "completeness":
        return (
          <span className="pn-cell-progress">
            <ProgressBar value={row.completeness_pct} />
            <span className="pn-cell-date">{row.completeness_pct}%</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Membership"
        title="Members"
        sub="Every membership record. Contact details stay masked; revealing them is a recorded, one-at-a-time step on the member's page."
      />
      <PanelCard
        title="Members"
        count={result === undefined ? undefined : `· ${result.total}`}
        tight
      >
        <div className="pn-filterbar">
          <FilterChips
            options={chips}
            active={filter}
            onSelect={(key) => {
              setFilter(key as "all" | Lifecycle);
              setPage(1);
            }}
            label="Status filter"
          />
          <span className="sp" />
          <SearchInput
            value={q}
            onChange={(value) => {
              setQ(value);
              setPage(1);
            }}
            placeholder="Search by name or email"
          />
        </div>
        {result === undefined ? (
          <p className="pn-meta pn-loading">Loading…</p>
        ) : (
          <>
            <DataTable
              columns={COLUMNS}
              rows={result.rows}
              rowKey={(row) => row.memberId}
              renderCell={renderCell}
              onRowClick={(row) => go("member", row.memberId)}
              empty={
                <EmptyState
                  eyebrow="Members"
                  message={
                    q.trim() !== ""
                      ? "No members match this search. Email search happens on the server, so an exact address works too."
                      : filter === "all"
                        ? "No members yet. They appear here as women join through the site or claim their old-list record."
                        : "No members in this status right now."
                  }
                />
              }
            />
            {result.total > 0 ? (
              <div className="pn-pager">
                <p className="pn-meta">
                  Showing {result.rows.length} of {result.total} · Page{" "}
                  {result.page} of {result.page_count}
                </p>
                <button
                  type="button"
                  className="pn-btn pn-btn--ghost pn-btn--sm"
                  disabled={result.page <= 1}
                  onClick={() => setPage(result.page - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="pn-btn pn-btn--ghost pn-btn--sm"
                  disabled={result.page >= result.page_count}
                  onClick={() => setPage(result.page + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        )}
      </PanelCard>
    </>
  );
}
