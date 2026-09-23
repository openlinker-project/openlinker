/**
 * One task on the assign board (#3340; mobile-first rebuild, epic #3401)
 *
 * The mockup's `.lane-card`: a reference, one badge, the buyer, and the
 * staffing controls. ONE component at every width — it reflows rather than
 * swapping, because the question a supervisor is answering is the same on a
 * phone as on a desk ("who packs this?") and the answer needs the same four
 * facts.
 *
 * ## Why it replaced `FulfillmentWorklistRow` rather than reusing it
 *
 * That row belonged to the execution worklist (#2410), where a location id, a
 * delivery method and a variant id are what an operator works from. Here they
 * are noise, and on a phone its label/value stack rendered them as a
 * screenful of raw internal ids — `ol_location_bab164c3…`,
 * `ol_variant_db188778…` — one card filling the viewport. A supervisor
 * deciding who packs a box does not read variant ids.
 *
 * The worklist has since been merged into this screen and the row deleted, so
 * this is the only task card on it. `FulfillmentTaskCard` survives separately
 * for the order-detail panel, which answers a different question again.
 *
 * ## It states what it does NOT know
 *
 * `orderReference` and `buyerNameMasked` come from the order, which a task does not
 * carry until the board's own read supplies them. Absent, the card falls back
 * to the work's own id rather than rendering an empty line, and says nothing
 * about a buyer at all — an em-dash placeholder in a buyer slot reads as "no
 * buyer", which is a different and false claim.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { LiHTMLAttributes, ReactElement } from 'react';

import { formatShipBy, type ShipByLevel } from '../../../shared/format/format-ship-by';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';
import { fulfillmentStatusLabel } from '../lib/fulfillment-task.copy';

/**
 * Ship-by urgency level (#927) → StatusBadge tone — the `order-detail-page` /
 * `orders-list-page` precedent. `formatShipBy` stays free of a `shared/ui`
 * dependency, so the mapping lives at the call site.
 */
const SHIP_BY_TONE: Record<ShipByLevel, StatusBadgeTone> = {
  ok: 'info',
  soon: 'warning',
  overdue: 'error',
};

export interface AssignPackingWorkCardProps {
  readonly task: FulfillmentTask;
  /** This screen's staffing controls — never the execution actions. */
  readonly actions: ReactElement | null;
  /** Drag-source props plus the assignment-only class; see the lane section. */
  readonly rootProps?: LiHTMLAttributes<HTMLLIElement>;
  /**
   * Whether THIS card is a drag source — mirrors the lane section's own
   * `dragEnabled` gate. The grip is purely visual (the `<li>` itself already
   * carries `draggable` via `rootProps`), so it must not render on an axis
   * where drag is off, or it would advertise an affordance the row does not
   * have.
   */
  readonly dragEnabled?: boolean;
}

/**
 * ONE badge, carrying the most salient thing about the task — the same rule
 * the bench rail follows. A hold outranks a deadline because it is why the
 * box must not be packed at all; a deadline outranks the plain state because
 * the state is already implied by the lane the card sits in.
 */
function badgeFor(task: FulfillmentTask): { tone: StatusBadgeTone; label: string } | null {
  const hold = task.activeHolds[0];
  if (hold !== undefined) {
    return { tone: 'error', label: ASSIGN_PACKING_WORK_COPY.card.heldBadge };
  }
  // A board spans several days, so a bare time-of-day ("11:59 PM") is
  // ambiguous about which day it means, and a single hardcoded `warning`
  // tone stopped meaning anything once every row wore it. `formatShipBy`
  // (#927) carries both the day-scale phrase and the real urgency level;
  // `null` — no or an unparseable deadline — renders nothing, never a
  // false countdown.
  const shipBy = formatShipBy(task.dispatchByAt ?? null);
  if (shipBy !== null) {
    return { tone: SHIP_BY_TONE[shipBy.level], label: shipBy.remaining };
  }
  if (task.status !== 'open') {
    // Humanised, never raw. `status` is a server vocabulary the FE
    // deliberately does not mirror (`fulfillment.types.ts`), so an unknown
    // value still reaches the screen — and `awaiting_wave` on a badge is the
    // system's word, not the operator's. The worklist this screen absorbed
    // ran every status through this helper; the card inherits that rather
    // than losing it with the component.
    return { tone: 'neutral', label: fulfillmentStatusLabel(task.status) };
  }
  return null;
}

export function AssignPackingWorkCard({
  task,
  actions,
  rootProps = {},
  dragEnabled = false,
}: AssignPackingWorkCardProps): ReactElement {
  const badge = badgeFor(task);
  const units = task.lines.reduce((sum, line) => sum + line.totalQuantity, 0);
  const { className: rootClassName, ...restRootProps } = rootProps;

  return (
    <li
      className={['assign-packing-work-card', rootClassName].filter(Boolean).join(' ')}
      data-testid="assign-packing-work-card"
      data-task-id={task.id}
      {...restRootProps}
    >
      {/* Visual only — the `<li>` itself is the real drag source (see
          `rootProps`). Absent on an axis where drag is off, matching the
          card's own `draggable` state. */}
      {dragEnabled ? (
        <span
          className="assign-packing-work-card__grip"
          aria-hidden="true"
          title={ASSIGN_PACKING_WORK_COPY.drag.gripHint}
        >
          ⠿
        </span>
      ) : null}

      {/* Reference and badge sit SIDE BY SIDE in the row, as siblings — the
          mockup's `.lane-card__top { display: contents }`. They were briefly
          stacked in a box of their own to keep `__buyer`'s left edge steady
          while badge widths varied; a fixed base on the reference does that
          on one line instead, and one line is what makes every row the same
          height. An absent badge therefore needs no invisible stand-in: on a
          single-line row it costs no height to leave out.

          Truncated with an ellipsis (CSS), never wrapped — a real reference
          here is often a 36-char internal id where the order carries no
          source reference, and `title` gives a desk surface's hover the tail
          that truncation takes. */}
      <span
        className="assign-packing-work-card__ref"
        title={task.orderReference ?? task.id}
      >
        {task.orderReference ?? task.id}
      </span>
      {badge === null ? null : (
        <StatusBadge tone={badge.tone} compact>
          {badge.label}
        </StatusBadge>
      )}

      {/* Always rendered, even with nothing inside it — an absent buyer name
          is a blank cell, not a missing one, so the columns after it never
          shift left. See the module docblock on why it is blank rather than
          placeheld. */}
      <span className="assign-packing-work-card__buyer">{task.buyerNameMasked ?? ''}</span>

      <span className="assign-packing-work-card__meta">
        {ASSIGN_PACKING_WORK_COPY.card.summary({
          lines: task.lines.length,
          units,
        })}
        {task.locationName == null ? null : <> · {task.locationName}</>}
      </span>

      <div className="assign-packing-work-card__actions">{actions}</div>
    </li>
  );
}
