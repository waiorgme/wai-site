import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { CertificateAdminRow } from "../../../convex/admin/certificates";
import type { ChipOption, Column } from "../../panel/kit";
import {
  DataTable,
  EmptyState,
  FilterChips,
  PageHeader,
  PanelCard,
  SearchInput,
} from "../../panel/kit";
import { CertificateRowActions } from "./CertificateActions";
import type { Go } from "./shared";
import { initials } from "./shared";

// Certificates admin (panel-experience spec F15). Records are archived, never
// deleted: revoke flips a status, a correction supersedes. The public
// verification page answers honestly for every token. Revoke and re-issue are
// reserved to super admins - the server checks; the row actions say so.

type CertStatus = CertificateAdminRow["status"];

const STATUS_WORDS: Record<CertStatus, string> = {
  valid: "Valid",
  superseded: "Superseded",
  revoked: "Revoked",
};

const COLUMNS: ReadonlyArray<Column> = [
  { key: "recipient", header: "Recipient" },
  { key: "number", header: "Number", width: "160px" },
  { key: "status", header: "Status", width: "130px" },
  { key: "issued", header: "Issued", width: "150px" },
  { key: "member", header: "Member record", width: "130px" },
  { key: "actions", header: "Actions", width: "220px" },
];

export function CertificatesView({ go }: { go: Go }) {
  const [filter, setFilter] = useState<"all" | CertStatus>("all");
  const [q, setQ] = useState("");

  // One unfiltered query (search server-side); the chips slice client-side so
  // every chip can carry its honest count.
  const rows = useQuery(api.admin.certificates.listCertificates, {
    search: q.trim() === "" ? undefined : q.trim(),
  });

  const chips: ChipOption[] =
    rows === undefined
      ? [{ key: "all", label: "All" }]
      : [
          { key: "all", label: "All", count: rows.length },
          ...(["valid", "superseded", "revoked"] as const).map((status) => ({
            key: status,
            label: STATUS_WORDS[status],
            count: rows.filter((r) => r.status === status).length,
          })),
        ];

  const filtered =
    rows === undefined
      ? []
      : filter === "all"
        ? rows
        : rows.filter((r) => r.status === filter);

  const renderCell = (row: CertificateAdminRow, col: Column) => {
    switch (col.key) {
      case "recipient":
        return (
          <span className="pn-cell-id">
            <span className="pn-initials">{initials(row.recipient_name)}</span>
            <span className="pn-cell-2l">
              <span className="t">{row.recipient_name}</span>
              {row.is_founding ? (
                <span className="pn-tag">Founding Member</span>
              ) : null}
            </span>
          </span>
        );
      case "number":
        return (
          <span className="pn-cell-date">WAIME-MEM-{row.membership_number}</span>
        );
      case "status":
        return (
          <span
            className={
              row.status === "valid"
                ? "pn-tag pn-tag--ok"
                : row.status === "revoked"
                  ? "pn-tag pn-tag--err"
                  : "pn-tag"
            }
          >
            {STATUS_WORDS[row.status]}
          </span>
        );
      case "issued":
        return <span className="pn-cell-date">{row.issued_date_label}</span>;
      case "member":
        return (
          <button
            type="button"
            className="pn-link"
            onClick={() => go("member", row.memberId)}
          >
            Open
          </button>
        );
      case "actions":
        return (
          <CertificateRowActions
            certificateId={row.certificateId}
            status={row.status}
            numberLabel={`WAIME-MEM-${row.membership_number}`}
            recipientName={row.recipient_name}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Membership"
        title="Certificates"
        sub="Every certificate ever issued stays on the record. Revoking or correcting never deletes; the public verification page answers honestly for each one."
      />
      <PanelCard
        title="All certificates"
        count={rows === undefined ? undefined : `· ${rows.length}`}
        tight
      >
        <div className="pn-filterbar">
          <FilterChips
            options={chips}
            active={filter}
            onSelect={(key) => setFilter(key as "all" | CertStatus)}
            label="Certificate status filter"
          />
          <span className="sp" />
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Search by name or number"
          />
        </div>
        {rows === undefined ? (
          <p className="pn-meta pn-loading">Loading…</p>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={filtered}
            rowKey={(row) => row.certificateId}
            renderCell={renderCell}
            empty={
              <EmptyState
                eyebrow="Certificates"
                message={
                  q.trim() === ""
                    ? "No certificates in this view. One is issued each time a membership becomes active."
                    : "Nothing matches this search - try the member's name or the number without the WAIME-MEM prefix."
                }
              />
            }
          />
        )}
      </PanelCard>
    </>
  );
}
