/**
 * One task on the assign board (#3340; mobile-first rebuild, epic #3401)
 *
 * The mockup's `.lane-card`: a reference, one badge, the buyer, and the
 * staffing controls. ONE component at every width — it reflows rather than
 * swapping, because the question a supervisor is answering is the same on a
 * phone as on a desk ("who packs this?") and the answer needs the same four
 * facts.
 *
 * ## Why this screen does not reuse `FulfillmentWorklistRow` / `FulfillmentTaskCard`
 *
 * Those belong to the EXECUTION worklist (#2410), where a location id, a
 * delivery method and a variant id are what an operator is working from. On
 * the assign board they are noise, and on a phone the generic card's
 * label/value stack rendered them as a screenful of raw internal ids —
 * `ol_location_bab164c3…`, `ol_variant_db188778…` — one card filling the
 * viewport. A supervisor deciding who packs a box does not read variant ids.
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

import { formatAbsoluteTime } from '../../../shared/format/format-date';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';

export interface AssignPackingWorkCardProps {
  readonly task: FulfillmentTask;
  /** This screen's staffing controls — never the execution actions. */
  readonly actions: ReactElement | null;
  /** Drag-source props plus the assignment-only class; see the lane section. */
  readonly rootProps?: LiHTMLAttributes<HTMLLIElement>;
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
  if (task.dispatchByAt != null) {
    return { tone: 'warning', label: formatAbsoluteTime(task.dispatchByAt) };
  }
  if (task.status !== 'open') {
    return { tone: 'neutral', label: task.status };
  }
  return null;
}

export function AssignPackingWorkCard({
  task,
  actions,
  rootProps = {},
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
      <div className="assign-packing-work-card__identity">
        <div className="assign-packing-work-card__top">
          <span className="assign-packing-work-card__ref">
            {task.orderReference ?? task.id}
          </span>
          {badge === null ? null : (
            <StatusBadge tone={badge.tone} compact>
              {badge.label}
            </StatusBadge>
          )}
        </div>
        {/* Absent rather than placeheld — see the module docblock. */}
        {task.buyerNameMasked == null ? null : (
          <span className="assign-packing-work-card__buyer">{task.buyerNameMasked}</span>
        )}
        <span className="assign-packing-work-card__meta">
          {ASSIGN_PACKING_WORK_COPY.card.summary({
            lines: task.lines.length,
            units,
          })}
          {task.locationName == null ? null : <> · {task.locationName}</>}
        </span>
      </div>

      <div className="assign-packing-work-card__actions">{actions}</div>
    </li>
  );
}
