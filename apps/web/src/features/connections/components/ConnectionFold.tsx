/**
 * ConnectionFold — the tablet relocation of `ConnectionCell`'s first line
 * (#1996, #2094).
 *
 * `hideBelow: 1024` fires at `max-width: 1023.98px`, so on Products, Shipments
 * and Invoices the Connection column is **already gone at 768 px** — that value
 * means "desktop only" in practice. Rather than let the fact vanish, it
 * relocates into whichever adjacent cell owns the neighbouring question, the
 * pattern `.orders-order-channel` already establishes for the channel pill.
 * Lowering the three thresholds to 768 was the cheaper option and was rejected
 * in #1996: it keeps the column only behind horizontal scroll, and a fact an
 * operator has to scroll sideways to find is one they stop checking.
 *
 * This is `ConnectionCell`'s FIRST LINE, relocated — not a third variant of the
 * cell. It carries the adornment and the resolved name and deliberately **no
 * copyable id**: an id exists to be copied, and copying here is a pointer
 * affordance (`CopyableId`'s button reveals on row hover, which does not exist
 * on touch). At tablet width the question is "which connection is this?", which
 * the name answers; "give me its id" stays a desktop and detail-page action.
 *
 * Which surface is visible is decided in CSS, not here: `.conn-fold` is
 * `display: none` above the breakpoint, where the standalone column renders.
 * `display: none` also drops the element from the accessibility tree, so
 * exactly one of the two renderings is exposed at any width — a screen reader
 * never hears the same connection twice.
 *
 * @module features/connections/components
 * @see {@link ConnectionCell} for the desktop cell this mirrors.
 */
import type { ReactElement, ReactNode } from 'react';
import type { ConnectionCellFacts } from './ConnectionCell';
import { ConnectionEntityLabel } from './ConnectionEntityLabel';

export interface ConnectionFoldProps {
  connectionId: string;
  /**
   * The SAME object the page hands `ConnectionCell` — a whole `Connection`
   * satisfies it, and only `name` is read here.
   *
   * Required (and explicitly nullable) rather than optional: `ConnectionCell`
   * reads `undefined` as "resolve it yourself" and falls back to a per-row
   * fetch, which #1996 rejected. The fold has no such fallback by construction,
   * so a page that forgets to coalesce its `Map.get()` miss fails to compile
   * instead of silently reinstating one request per row.
   */
  connection: ConnectionCellFacts | null;
  /**
   * Page-supplied loading state for the window before the batched connections
   * query settles — without it every row reads "Unknown" on a cold load.
   */
  loading?: boolean;
  /**
   * The same adornment the desktop cell uses on that page: a channel pill on
   * Products, a `ConnectionDot` on Shipments, nothing on Invoices (where the
   * connection IS the issuing provider and the column header said so).
   */
  adornment?: ReactNode;
  className?: string;
}

export function ConnectionFold({
  connectionId,
  connection,
  loading = false,
  adornment,
  className = '',
}: ConnectionFoldProps): ReactElement | null {
  if (!connectionId) return null;

  const classes = ['conn-fold', className].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      {adornment ? <span className="conn-fold__adornment">{adornment}</span> : null}
      {/* `ConnectionEntityLabel` rather than a hand-rolled name span: it owns the
          link to `/connections/:id`, its self-page suppression, the "Unknown"
          branch (with the full id still reachable via `title`) and the loading
          placeholder. Reproducing those here is how the fold and the cell it
          mirrors would drift. `name` is always passed — including `null` — so
          the label never runs its own per-row query. */}
      <ConnectionEntityLabel
        connectionId={connectionId}
        name={connection?.name ?? null}
        loading={loading}
        showId={false}
        showCopy={false}
      />
    </span>
  );
}
