// Workspace kit (panel-experience slice): typed, dependency-free React
// components over the pn- workspace classes in src/styles/panel.css.
// Presentation only - callers wire data, routing and mutations. Usage doc
// and class-only recipes: the panel-kit.md handoff note (session scratchpad).

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

/* ---------- app shell ---------- */

// Desktop sidebar collapse survives reloads; per browser, not per account
// (a display preference, not member data).
const COLLAPSE_KEY = "pn-side-collapsed";

// Lets SideNav know the rail is collapsed so icon-only items grow native
// title tooltips without the callers threading the state through.
const SideCollapsedContext = createContext(false);

// 100dvh two-column shell: dark navy sidebar | paper main. On mobile the
// sidebar becomes a sticky top bar with a horizontal-scroll nav (CSS); the
// collapse control only exists on desktop, where the sidebar is a column.
export function AppShell({
  brand,
  nav,
  identity,
  children,
}: {
  // Logo/lockup content for the sidebar head (see panel-kit.md recipe).
  brand: ReactNode;
  // Usually a <SideNav />; rendered as a direct child of the sidebar.
  nav: ReactNode;
  // Who-am-I block pinned to the sidebar foot (avatar + name + email).
  identity?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((cur) => {
      const next = !cur;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable (private mode): the toggle still works for the session */
      }
      return next;
    });
  return (
    <div className={collapsed ? "pn-app is-side-collapsed" : "pn-app"}>
      <aside className="pn-app-side">
        <div className="pn-side-brand">
          {brand}
          <button
            type="button"
            className="pn-side-collapse"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={toggle}
          >
            <PanelGlyph />
          </button>
        </div>
        <SideCollapsedContext.Provider value={collapsed}>{nav}</SideCollapsedContext.Provider>
        {identity ? <div className="pn-side-id">{identity}</div> : null}
      </aside>
      {/* A div, not <main>: the astro shells already provide main#main, and
          nested main landmarks confuse assistive tech. */}
      <div className="pn-app-main">{children}</div>
    </div>
  );
}

function PanelGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

export type NavItem = {
  key: string;
  label: string;
  // Lucide outline glyph (src/panel/icons.tsx). Required for the collapsed
  // rail to make sense; decorative next to the label when expanded.
  icon?: ReactNode;
  count?: number;
  // Attention count: sky pill with dark ink (the lang-toggle AA precedent).
  live?: boolean;
  active?: boolean;
  // Honest dormant marker; replaces the count with a dashed "Soon" pill.
  soon?: boolean;
  onSelect?: () => void;
};

export type NavGroup = {
  // Mono uppercase group label; omit for an unlabelled group.
  label?: string;
  items: ReadonlyArray<NavItem>;
};

export function SideNav({
  groups,
  label,
}: {
  groups: ReadonlyArray<NavGroup>;
  // Accessible name for the <nav> landmark.
  label?: string;
}) {
  // Collapsed rail: labels hide visually, so the accessible name moves to
  // aria-label and a native title tooltip carries the sighted answer.
  const collapsed = useContext(SideCollapsedContext);
  return (
    <nav className="pn-side-nav" aria-label={label ?? "Sections"}>
      {groups.map((group, i) => (
        <div className="pn-side-grp" key={group.label ?? i}>
          {group.label ? <p className="pn-side-label">{group.label}</p> : null}
          {group.items.map((item) => {
            // aria-label overrides the content-derived name, so it must carry
            // the whole story a sighted user sees: the count pill or Soon.
            const name = item.soon
              ? `${item.label}, coming soon`
              : typeof item.count === "number"
                ? `${item.label}, ${item.count}`
                : item.label;
            return (
              <button
                key={item.key}
                type="button"
                className={item.soon ? "pn-app-nav-item is-soon" : "pn-app-nav-item"}
                aria-current={item.active ? "true" : undefined}
                aria-disabled={item.soon ? true : undefined}
                aria-label={name}
                title={collapsed ? name : undefined}
                onClick={item.onSelect}
              >
                {item.icon ? (
                  <span className="ic" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span className="lb">{item.label}</span>
                {item.soon ? (
                  <span className="n">Soon</span>
                ) : typeof item.count === "number" ? (
                  <span className={item.live ? "n live" : "n"}>{item.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/* ---------- page header ---------- */

// Eyebrow + display h1 + sub on the left; action cluster on the right.
// Convention: ghost buttons first, then exactly ONE primary.
export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="pn-page-head">
      <div className="lead">
        {eyebrow ? <p className="pn-eyebrow on-paper">{eyebrow}</p> : null}
        <h1 className="pn-h1">{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {actions ? <div className="pn-page-actions">{actions}</div> : null}
    </header>
  );
}

/* ---------- panel primitive ---------- */

// Section card: header row (h3 + mono count annotation + actions) over a
// hairline, then the body. tight=true drops body padding so tables and row
// lists (pn-event, pn-notif) run edge to edge.
export function PanelCard({
  title,
  count,
  actions,
  tight,
  children,
}: {
  title: string;
  // Mono annotation next to the title, e.g. "· 12 awaiting".
  count?: ReactNode;
  actions?: ReactNode;
  tight?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="pn-panel-card">
      <header className="pn-panel-head">
        <h3 className="pn-panel-title">{title}</h3>
        {count != null ? <span className="pn-panel-count">{count}</span> : null}
        {actions ? <div className="pn-panel-actions">{actions}</div> : null}
      </header>
      <div className={tight ? "pn-panel-body pn-panel-body--tight" : "pn-panel-body"}>
        {children}
      </div>
    </section>
  );
}

/* ---------- data table ---------- */

export type Column = {
  key: string;
  header: string;
  align?: "start" | "center" | "end";
  // Pinned width, e.g. "160px"; omit for fluid.
  width?: string;
};

// Dense table inside a horizontal-scroll wrapper. When onRowClick is given,
// a trailing arrow column holds the real (named, focusable) open control;
// whole-row click stays as a pointer convenience.
// Cell voices (identity, two-line, mono date) are class recipes: panel-kit.md.
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  renderCell,
  onRowClick,
  rowLabel,
  empty,
}: {
  columns: ReadonlyArray<Column>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row) => string;
  renderCell: (row: Row, col: Column) => ReactNode;
  onRowClick?: (row: Row) => void;
  // Accessible name for the row's open button, e.g. (m) => `Open ${m.name}`.
  rowLabel?: (row: Row) => string;
  // Shown instead of the table when rows is empty (usually an <EmptyState />).
  empty?: ReactNode;
}) {
  if (rows.length === 0) {
    return <div className="pn-table-empty">{empty ?? null}</div>;
  }
  const cellClass = (col: Column) =>
    col.align === "center" || col.align === "end" ? col.align : undefined;
  return (
    <div className="pn-table-wrap">
      <table className="pn-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cellClass(col)}
                style={col.width ? { inlineSize: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
            {onRowClick ? (
              <th className="pn-cell-arrow">
                <span className="sr-only">Open</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? "pn-rowlink" : undefined}
              onClick={
                onRowClick
                  ? (e: MouseEvent<HTMLTableRowElement>) => {
                      // nested controls (incl. the arrow button) own their clicks
                      if (
                        e.target instanceof Element &&
                        e.target.closest("button, a, input, select, textarea, label")
                      ) {
                        return;
                      }
                      onRowClick(row);
                    }
                  : undefined
              }
            >
              {columns.map((col) => (
                <td key={col.key} className={cellClass(col)}>
                  {renderCell(row, col)}
                </td>
              ))}
              {onRowClick ? (
                <td className="pn-cell-arrow">
                  <button
                    type="button"
                    className="pn-open"
                    aria-label={rowLabel ? rowLabel(row) : "Open"}
                    onClick={() => onRowClick(row)}
                  >
                    <ArrowGlyph />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArrowGlyph() {
  return (
    <span className="pn-arr" aria-hidden="true">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
    </span>
  );
}

/* ---------- filter bar pieces ---------- */

export type ChipOption = { key: string; label: string; count?: number };

// Filter chips with counts; selected chip inverts to solid navy. Compose
// inside a div.pn-filterbar with a span.sp spacer and a <SearchInput />.
export function FilterChips({
  options,
  active,
  onSelect,
  label,
}: {
  options: ReadonlyArray<ChipOption>;
  active: string;
  onSelect: (key: string) => void;
  label?: string;
}) {
  return (
    <div className="pn-fchips" role="group" aria-label={label ?? "Filters"}>
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className="pn-fchip"
          aria-pressed={opt.key === active}
          onClick={() => onSelect(opt.key)}
        >
          {opt.label}
          {typeof opt.count === "number" ? <span className="n">{opt.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  // Accessible name; falls back to the placeholder.
  label?: string;
}) {
  return (
    <span className="pn-search">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder ?? "Search"}
      />
    </span>
  );
}

/* ---------- KPI stat tile ---------- */

// Extends the .pn-stat voice with a glyph slot and escalation washes.
// attention = dawn wash with ink text (never gold); urgent = err wash.
export function StatTile({
  label,
  value,
  sub,
  glyph,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  // Small decorative svg mark (an icons.tsx glyph) in the top-end circle.
  glyph?: ReactNode;
  tone?: "default" | "attention" | "urgent";
}) {
  const cls = ["pn-stat"];
  if (tone === "attention") cls.push("pn-stat--attention");
  if (tone === "urgent") cls.push("pn-stat--urgent");
  if (glyph) cls.push("pn-stat--glyph");
  return (
    <div className={cls.join(" ")}>
      {glyph ? (
        <span className="g" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {sub ? <span className="s">{sub}</span> : null}
    </div>
  );
}

/* ---------- underline tabs ---------- */

export type TabItem = { key: string; label: string; count?: number };

// Detail-page underline tabs (the design-system tab glide). Rendered as a
// nav of buttons with aria-current, not ARIA tabs: each "tab" swaps whole
// page sections, so link semantics are the honest ones.
export function Tabs({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: ReadonlyArray<TabItem>;
  active: string;
  onSelect: (key: string) => void;
  label?: string;
}) {
  return (
    <nav className="pn-tabs" aria-label={label ?? "Views"}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className="pn-tab"
          aria-current={tab.key === active ? "true" : undefined}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
          {typeof tab.count === "number" ? <span className="n">{tab.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/* ---------- modal (propose-then-confirm at modal grade) ---------- */

// Render only while open (mount = open). Escape and backdrop-click close,
// focus moves to the dialog on mount, footer is ghost-cancel + ONE primary
// confirm with an optional audit note. Put the reason field in children
// (a .pn-label + .pn-input.pn-textarea).
export function Modal({
  title,
  sub,
  onClose,
  onConfirm,
  confirmLabel,
  cancelLabel,
  hideCancel,
  confirmDisabled,
  busy,
  footNote,
  children,
}: {
  title: string;
  // One line naming the subject, e.g. "Layla H. · currently active".
  sub?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  cancelLabel?: string;
  // Read-only dialogs (a pass, a preview) need ONE closer, not two.
  hideCancel?: boolean;
  confirmDisabled?: boolean;
  // True while the confirm mutation runs: Escape/backdrop stop dismissing
  // and Cancel disables, so the outcome always lands visibly.
  busy?: boolean;
  // Audit sentence in the footer, e.g. "This action is recorded.".
  footNote?: ReactNode;
  children?: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  // Callers pass inline onClose closures, so the mount effect must not
  // depend on them: re-running it re-focuses the dialog container and
  // steals focus from a text field on every keystroke (design sweep
  // blocker, 2026-07-07). The ref keeps the latest closure for the key
  // handler while the effect runs exactly once per mount.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const busyRef = useRef(busy === true);
  useEffect(() => {
    busyRef.current = busy === true;
  }, [busy]);
  // Backdrop clicks only close when the press also STARTED on the backdrop:
  // a drag that begins inside the dialog (text selection in the reason
  // field) releasing over the overlay must not discard the typed reason.
  const overlayPressRef = useRef(false);
  useEffect(() => {
    // aria-modal promises the background does not exist: trap Tab inside the
    // dialog, lock body scroll, and hand focus back to the opener on close.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    boxRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || boxRef.current === null) {
        return;
      }
      const focusable = Array.from(
        boxRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === boxRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (
        active instanceof HTMLElement &&
        !boxRef.current.contains(active)
      ) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
    // Mount-once by design: onClose lives in onCloseRef (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="pn-modal-overlay"
      onPointerDown={(e) => {
        overlayPressRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && overlayPressRef.current && busy !== true) onClose();
      }}
    >
      <div
        className="pn-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={boxRef}
        tabIndex={-1}
      >
        <div className="pn-modal-head">
          <h3 className="pn-modal-title" id={titleId}>
            {title}
          </h3>
          {sub ? <p className="pn-modal-sub">{sub}</p> : null}
        </div>
        {children ? <div className="pn-modal-body">{children}</div> : null}
        <div className="pn-modal-foot">
          {footNote ? <p className="note">{footNote}</p> : null}
          {!hideCancel && (
            <button
              type="button"
              className="pn-btn pn-btn--ghost pn-btn--sm"
              onClick={onClose}
              disabled={busy}
            >
              {cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            type="button"
            className="pn-btn pn-btn--sm"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- progress bar ---------- */

export function ProgressBar({
  label,
  value,
  valueLabel,
}: {
  label?: string;
  // 0-100; clamped.
  value: number;
  // Mono end-of-row annotation, e.g. "7 of 12".
  valueLabel?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="pn-progress">
      {label || valueLabel ? (
        <div className="row">
          {label ? <span className="l">{label}</span> : null}
          {valueLabel ? <span className="v">{valueLabel}</span> : null}
        </div>
      ) : null}
      <div
        className="track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label ?? "Progress"}
      >
        <div className="fill" style={{ "--pn-pct": `${pct}%` } as CSSProperties} />
      </div>
    </div>
  );
}

/* ---------- date block (event rows) ---------- */

// Square date tile: mono month over display-bold day. Compose inside a
// div.pn-event row (see panel-kit.md recipe).
export function DateBlock({ month, day }: { month: string; day: ReactNode }) {
  return (
    <span className="pn-date-block">
      <span className="m">{month}</span>
      <span className="d">{day}</span>
    </span>
  );
}

/* ---------- notification row ---------- */

// Unread rows carry a sky dot; read rows dim the title. With onOpen the
// whole row becomes a button.
export function NotificationRow({
  title,
  body,
  when,
  unread,
  onOpen,
}: {
  title: string;
  body?: ReactNode;
  // Pre-formatted timestamp, e.g. "10:42" / "Mon" / "12 Jan".
  when: string;
  unread?: boolean;
  onOpen?: () => void;
}) {
  const cls = unread ? "pn-notif" : "pn-notif is-read";
  const inner = (
    <>
      {unread ? <span className="dot" aria-hidden="true" /> : null}
      <span className="row1">
        <span className="t">{title}</span>
        <span className="when">{when}</span>
      </span>
      {body ? <span className="b">{body}</span> : null}
    </>
  );
  return onOpen ? (
    <button type="button" className={cls} onClick={onOpen}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/* ---------- empty state ---------- */

// Calm designed empty: mono eyebrow + one sentence + optional soft action.
export function EmptyState({
  eyebrow,
  message,
  action,
}: {
  eyebrow?: string;
  message: ReactNode;
  // Usually a ghost .pn-btn or a .pn-link.
  action?: ReactNode;
}) {
  return (
    <div className="pn-empty">
      {eyebrow ? <span className="k">{eyebrow}</span> : null}
      <p>{message}</p>
      {action ?? null}
    </div>
  );
}
