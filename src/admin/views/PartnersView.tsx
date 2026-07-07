import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { PartnerListRow } from "../../../convex/admin/partners";
import type { ChipOption, Column } from "../../panel/kit";
import {
  DataTable,
  EmptyState,
  FilterChips,
  PageHeader,
  PanelCard,
} from "../../panel/kit";
import type { Go, PartnerStatus } from "./shared";
import {
  dateStringLabel,
  PARTNER_STATUS_WORDS,
  partnerStatusTagClass,
  TIER_EXPLAIN,
  TIER_WORDS,
} from "./shared";

// Partners list (panel-experience spec G16): relationship records, outcome-led.
// Tiers are outcome words with their plain one-liner; no payments, no
// contracts, no public exposure decisions here.

const CHIP_ORDER: ReadonlyArray<PartnerStatus> = [
  "prospect",
  "active",
  "lapsed",
  "declined",
];

const COLUMNS: ReadonlyArray<Column> = [
  { key: "partner", header: "Partner" },
  { key: "tier", header: "Tier" },
  { key: "status", header: "Status", width: "150px" },
  { key: "seal", header: "Seal", width: "110px" },
  { key: "mou", header: "MOU signed", width: "120px" },
  { key: "deliverables", header: "Delivered", width: "110px", align: "end" },
];

export function PartnersView({ go }: { go: Go }) {
  const partners = useQuery(api.admin.partners.listPartners, {});
  const [filter, setFilter] = useState<"all" | PartnerStatus>("all");

  const chips: ChipOption[] =
    partners === undefined
      ? [{ key: "all", label: "All" }]
      : [
          { key: "all", label: "All", count: partners.length },
          ...CHIP_ORDER.map((status) => ({
            key: status,
            label: PARTNER_STATUS_WORDS[status],
            count: partners.filter((p) => p.status === status).length,
          })),
        ];

  const rows =
    partners === undefined
      ? []
      : filter === "all"
        ? partners
        : partners.filter((p) => p.status === filter);

  const renderCell = (row: PartnerListRow, col: Column) => {
    switch (col.key) {
      case "partner":
        return (
          <span className="pn-cell-2l">
            <span className="t">{row.name}</span>
            {row.contact_name !== null ? (
              <span className="s">{row.contact_name}</span>
            ) : null}
          </span>
        );
      case "tier":
        return (
          <span className="pn-cell-2l">
            <span className="t">{TIER_WORDS[row.tier]}</span>
            <span className="s">{TIER_EXPLAIN[row.tier]}</span>
          </span>
        );
      case "status":
        return (
          <span className={partnerStatusTagClass(row.status)}>
            {PARTNER_STATUS_WORDS[row.status]}
          </span>
        );
      case "seal":
        return row.seal === "granted" ? (
          <span className="pn-tag pn-tag--ok">Granted</span>
        ) : row.seal === "withdrawn" ? (
          <span className="pn-tag pn-tag--err">Withdrawn</span>
        ) : (
          <span className="pn-meta">None</span>
        );
      case "mou":
        return row.mou_signed_on === null ? (
          <span className="pn-meta">Not signed</span>
        ) : (
          <span className="pn-cell-date">{dateStringLabel(row.mou_signed_on)}</span>
        );
      case "deliverables":
        return row.deliverables_total === 0 ? (
          <span className="pn-meta">None yet</span>
        ) : (
          <span className="pn-mono">
            {row.deliverables_delivered} of {row.deliverables_total}
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
        title="Partners"
        sub="Companies backing the community: what each one committed and what has actually been delivered. MOU language, no payments here."
        actions={
          <button
            type="button"
            className="pn-btn pn-btn--sm"
            onClick={() => go("partnerEditor")}
          >
            New partner
          </button>
        }
      />
      <PanelCard
        title="All partners"
        count={partners === undefined ? undefined : `· ${partners.length}`}
        tight
      >
        <div className="pn-filterbar">
          <FilterChips
            options={chips}
            active={filter}
            onSelect={(key) => setFilter(key as "all" | PartnerStatus)}
            label="Partner status filter"
          />
        </div>
        {partners === undefined ? (
          <p className="pn-meta pn-loading">Loading…</p>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.partnerId}
            renderCell={renderCell}
            onRowClick={(row) => go("partnerEditor", row.partnerId)}
            empty={
              <EmptyState
                eyebrow="Partners"
                message={
                  filter === "all"
                    ? "No partner records yet. A company that emails support@waiorg.me becomes a record here once you create it."
                    : "No partners in this state right now."
                }
                action={
                  filter === "all" ? (
                    <button
                      type="button"
                      className="pn-btn pn-btn--ghost pn-btn--sm"
                      onClick={() => go("partnerEditor")}
                    >
                      New partner
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
