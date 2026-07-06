import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  EmptyState,
  NotificationRow,
  PageHeader,
  PanelCard,
} from "../../panel/kit";
import { whenLabel } from "../format";
import { hrefToView, type PortalGo } from "../PortalShell";

// The notification center (spec E12): newest first, unread count, mark all
// read, and rows that open their subject. Portal hrefs resolve to in-shell
// views; anything else (like /verify) is a plain navigation.

// Mirrors the server's page size (convex/notifications.ts PAGE_SIZE).
const PAGE_SIZE = 25;

type Rows = ReturnType<typeof useQuery<typeof api.notifications.myNotifications>>;
type Row = NonNullable<Rows>[number];

export function NotificationsView({ go }: { go: PortalGo }) {
  const [page, setPage] = useState(0);
  const rows: Rows = useQuery(api.notifications.myNotifications, { page });
  const unread = useQuery(api.notifications.unreadCount);
  const markAll = useMutation(api.notifications.markAllRead);
  const markOne = useMutation(api.notifications.markRead);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const doMarkAll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await markAll({});
      setMessage(
        res.ok
          ? "All caught up - everything is marked read."
          : "That didn't work. Please try again.",
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const open = async (row: Row) => {
    // The read receipt is best-effort presentation state; opening the
    // subject must never fail because of it.
    try {
      await markOne({ notificationId: row.id });
    } catch {
      /* the row simply stays unread */
    }
    if (row.href !== null) {
      const view = hrefToView(row.href);
      if (view !== null) {
        go({ v: view });
      } else {
        window.location.assign(row.href);
      }
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Notifications"
        title="Notifications"
        sub={
          unread === undefined
            ? "Your seats, applications, certificates and standing - everything lands here."
            : unread === 0
              ? "You're all caught up."
              : unread === 1
                ? "1 unread."
                : `${unread} unread.`
        }
        actions={
          <button
            type="button"
            className="pn-btn pn-btn--ghost pn-btn--sm"
            disabled={busy || unread === 0}
            onClick={() => void doMarkAll()}
          >
            {busy ? "Marking…" : "Mark all read"}
          </button>
        }
      />

      {message !== null && (
        <p className="pn-meta" role="status">
          {message}
        </p>
      )}

      <PanelCard title="Latest first" tight>
        {rows === undefined ? (
          <p className="pn-meta pn-loading">Loading…</p>
        ) : rows === null ? (
          <p className="pn-meta pn-loading">
            Notifications open once your membership is linked.
          </p>
        ) : rows.length === 0 ? (
          <div className="pn-table-empty">
            <EmptyState
              eyebrow="Notifications"
              message={
                page === 0
                  ? "Nothing yet. Your seats, applications and certificates all land here."
                  : "That's everything - there's nothing older."
              }
            />
          </div>
        ) : (
          rows.map((row) => (
            <NotificationRow
              key={row.id}
              title={row.title}
              body={row.body}
              when={whenLabel(row.created_at)}
              unread={row.read_at === null}
              onOpen={() => void open(row)}
            />
          ))
        )}
        {(page > 0 || (rows !== undefined && rows !== null && rows.length === PAGE_SIZE)) && (
          <div className="pn-pager">
            <span className="pn-meta">Page {page + 1}</span>
            <button
              type="button"
              className="pn-btn pn-btn--ghost pn-btn--sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Newer
            </button>
            <button
              type="button"
              className="pn-btn pn-btn--ghost pn-btn--sm"
              disabled={rows == null || rows.length < PAGE_SIZE}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
            </button>
          </div>
        )}
      </PanelCard>
    </>
  );
}
