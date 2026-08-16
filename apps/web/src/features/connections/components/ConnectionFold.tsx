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
 * `display: none` above the breakpoint, where the standalone column renders. The
 * two media queries are the exact complement of each other, so the invariant the
 * design needs — **never both** — holds at every width, and between 768px and
 * the breakpoint exactly one is exposed. (Below 768 `DataTable` swaps to cards
 * and neither renders; a card-view fold is #2094's declared out-of-scope.)
 *
 * `display: none` rather than `visibility: hidden` for a layout reason, not an
 * accessibility one — both drop out of the accessibility tree, but `visibility`
 * still occupies space, so at desktop width the fold would reserve a phantom
 * third line inside all three host cells.
 *
 * @module features/connections/components
 * @see {@link ConnectionCell} for the desktop cell this mirrors.
 */
import type { ReactElement, ReactNode } from 'react';
import { shortenId } from '../../../shared/ui/entity-label';
import type { ConnectionStatus } from '../api/connections.types';
import type { ConnectionCellFacts } from './ConnectionCell';
import { ConnectionEntityLabel } from './ConnectionEntityLabel';

/** Same vocabulary as `ConnectionCell`'s line 2, minus the label text: at this
 *  size the dot carries the signal and its `title` carries the word. */
const STATUS_NOTES: Record<Exclude<ConnectionStatus, 'active'>, string> = {
  disabled: 'Disabled',
  error: 'Error',
  needs_reauth: 'Re-auth',
};

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
}

export function ConnectionFold({
  connectionId,
  connection,
  loading = false,
  adornment,
}: ConnectionFoldProps): ReactElement | null {
  if (!connectionId) return null;

  const status = connection?.status ?? null;
  // The reduction is "no copyable id", NOT "no status": an id is a thing you
  // copy, a status is a thing you read, and reading is exactly what tablet width
  // is for. A `needs_reauth` carrier connection is the direct cause of a wall of
  // failed labels, and a `disabled` invoicing connection is why documents
  // stopped issuing — dropping that here would hide the answer on the surface
  // where the operator is asking the question. Costs no height: the dot is
  // inline (#2094 review).
  const statusNote = status && status !== 'active' ? STATUS_NOTES[status] : null;

  return (
    <span className="conn-fold">
      {/* The fold sits inside another column's cell, so it loses the `<th>` that
          gave the desktop rendering its meaning. Without this a screen reader
          reads "…, Invoice (faktura), link inFakt" with nothing saying what
          `inFakt` is. */}
      <span className="sr-only">Connection: </span>
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
      {/* The one case where the id-is-a-desktop-concern argument inverts: a
          connection that does not resolve is exactly when an operator needs its
          raw id for a support ticket, and `EntityLabel`'s Unknown branch puts
          the id only in a `title` — which touch does not have. Shortened, still
          not copyable. */}
      {!loading && connection === null ? (
        <span className="conn-fold__id mono-text">{shortenId(connectionId)}</span>
      ) : null}
      {statusNote ? (
        <span
          className={`conn-fold__status conn-fold__status--${status}`}
          title={statusNote}
        >
          <span className="conn-fold__status-dot" aria-hidden="true" />
          <span className="sr-only">{statusNote}</span>
        </span>
      ) : null}
    </span>
  );
}
