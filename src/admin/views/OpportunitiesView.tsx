import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { AdminOpportunityRow } from "../../../convex/admin/opportunities";
import type { ChipOption, Column } from "../../panel/kit";
import {
  DataTable,
  EmptyState,
  FilterChips,
  PageHeader,
  PanelCard,
} from "../../panel/kit";
import type { Go, OpportunityState } from "./shared";
import {
  fmtGstDeadline,
  OPP_STATE_WORDS,
  OPP_TYPE_WORDS,
  oppStateTagClass,
} from "./shared";

// Admin opportunities list (panel-experience spec B7): every listing in every
// state, newest first, with live application counts. Rows open the editor,
// which also carries the applications, results and the decide step.

const CHIP_ORDER: ReadonlyArray<OpportunityState> = [
  "draft",
  "open",
  "closed",
  "decided",
];

const COLUMNS: ReadonlyArray<Column> = [
  { key: "listing", header: "Listing" },
  { key: "type", header: "Type", width: "150px" },
  { key: "deadline", header: "Deadline", width: "210px" },
  { key: "applications", header: "Applications", width: "110px", align: "end" },
  { key: "state", header: "State", width: "110px" },
];

export function OpportunitiesView({ go }: { go: Go }) {
  const listings = useQuery(api.admin.opportunities.adminListOpportunities);
  const [filter, setFilter] = useState<"all" | OpportunityState>("all");

  const chips: ChipOption[] =
    listings === undefined
      ? [{ key: "all", label: "All" }]
      : [
          { key: "all", label: "All", count: listings.length },
          ...CHIP_ORDER.map((state) => ({
            key: state,
            label: OPP_STATE_WORDS[state],
            count: listings.filter((o) => o.state === state).length,
          })),
        ];

  const rows =
    listings === undefined
      ? []
      : filter === "all"
        ? listings
        : listings.filter((o) => o.state === filter);

  const renderCell = (row: AdminOpportunityRow, col: Column) => {
    switch (col.key) {
      case "listing":
        return (
          <span className="pn-cell-2l">
            <span className="t">{row.title}</span>
            {row.partner_name !== null ? (
              <span className="s">with {row.partner_name}</span>
            ) : null}
          </span>
        );
      case "type":
        return OPP_TYPE_WORDS[row.type];
      case "deadline":
        return row.deadline === null ? (
          <span className="pn-meta">No deadline</span>
        ) : (
          <span className="pn-cell-date">{fmtGstDeadline(row.deadline)}</span>
        );
      case "applications":
        return row.type === "evergreen" ? (
          <span className="pn-meta">Claim path</span>
        ) : (
          <span className="pn-mono">{row.application_counts.active}</span>
        );
      case "state":
        return (
          <span className={oppStateTagClass(row.state)}>
            {OPP_STATE_WORDS[row.state]}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Programmes"
        title="Opportunities"
        sub="Scholarships, placements and ongoing benefits. Every applicant gets an answer before a cycle can be declared finished."
        actions={
          <button
            type="button"
            className="pn-btn pn-btn--sm"
            onClick={() => go("opportunityEditor")}
          >
            New opportunity
          </button>
        }
      />
      <PanelCard
        title="All listings"
        count={listings === undefined ? undefined : `· ${listings.length}`}
        tight
      >
        <div className="pn-filterbar">
          <FilterChips
            options={chips}
            active={filter}
            onSelect={(key) => setFilter(key as "all" | OpportunityState)}
            label="Listing state filter"
          />
        </div>
        {listings === undefined ? (
          <p className="pn-meta pn-loading">Loading…</p>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.opportunityId}
            renderCell={renderCell}
            onRowClick={(row) => go("opportunityEditor", row.opportunityId)}
            empty={
              <EmptyState
                eyebrow="Opportunities"
                message={
                  filter === "all"
                    ? "No listings yet. Create the first one; it starts as a draft."
                    : "No listings in this state right now."
                }
                action={
                  filter === "all" ? (
                    <button
                      type="button"
                      className="pn-btn pn-btn--ghost pn-btn--sm"
                      onClick={() => go("opportunityEditor")}
                    >
                      New opportunity
                    </button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </PanelCard>
    </>
  );
}
