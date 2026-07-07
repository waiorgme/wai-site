import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { AdminAuditRow } from "../../convex/admin/audit";
import { linkBtn, muted } from "../portal/ui";
import { queueSection, rowMeta } from "./ui";
import { fmtGstDateTime, plainAction } from "./views/shared";

// Audit visibility, read-only (spec criterion 8). Recent admin_fallback audit
// rows, paginated, so a super admin can see what the panel itself has done.
// Summaries are already PII-free.

export function AdminAuditLog() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  // Pages already read stay on screen: "Show older" appends the next page
  // below instead of replacing the view, so the newest rows never vanish and
  // there is nothing to navigate back from.
  const [loaded, setLoaded] = useState<AdminAuditRow[]>([]);
  const page = useQuery(api.admin.audit.listAdminAuditLog, { cursor });
  const rows = [...loaded, ...(page?.rows ?? [])];

  return (
    <section className={queueSection}>
      {page === undefined && rows.length === 0 ? (
        <p className={muted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={muted}>Nothing recorded yet.</p>
      ) : (
        <>
          {/* Same hairline log treatment as the Overview peek: read-only rows
              do not need boxed cards. */}
          <div className="pn-log">
            {rows.map((row) => (
              <div key={row.id} className="pn-log-row">
                <span className="pn-when">{fmtGstDateTime(row.timestamp)}</span>
                <p className={rowMeta}>
                  <strong>{plainAction(row.action)}</strong> by {row.actor}
                </p>
                {row.after_summary && (
                  <p className={rowMeta}>{row.after_summary}</p>
                )}
              </div>
            ))}
          </div>
          {page === undefined ? (
            <p className={muted}>Loading…</p>
          ) : (
            page.nextCursor !== null && (
              <button
                type="button"
                className={linkBtn}
                onClick={() => {
                  setLoaded(rows);
                  setCursor(page.nextCursor ?? undefined);
                }}
              >
                Show older
              </button>
            )
          )}
        </>
      )}
    </section>
  );
}
