import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { linkBtn, muted } from "../portal/ui";
import { queueSection, queueTitle, rowCard, rowMeta } from "./ui";

// Audit visibility, read-only (spec criterion 8). Recent admin_fallback audit
// rows, paginated, so a super admin can see what the panel itself has done.
// Summaries are already PII-free.

export function AdminAuditLog() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const page = useQuery(api.admin.audit.listAdminAuditLog, { cursor });

  return (
    <section style={queueSection}>
      <h2 style={queueTitle}>Recent panel actions</h2>
      {page === undefined ? (
        <p style={muted}>Loading…</p>
      ) : page.rows.length === 0 ? (
        <p style={muted}>Nothing recorded yet.</p>
      ) : (
        <>
          {page.rows.map((row) => (
            <div key={row.id} style={rowCard}>
              <p style={rowMeta}>
                <strong style={{ color: "var(--white)" }}>{row.action}</strong> by{" "}
                {row.actor} on {new Date(row.timestamp).toLocaleString()}
              </p>
              {row.after_summary && <p style={rowMeta}>{row.after_summary}</p>}
            </div>
          ))}
          {page.nextCursor !== null && (
            <button
              type="button"
              style={linkBtn}
              onClick={() => setCursor(page.nextCursor ?? undefined)}
            >
              Show older
            </button>
          )}
        </>
      )}
    </section>
  );
}
