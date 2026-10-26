/**
 * Assign Packing Work row controls (#3340, ADR-074; menu + stable slot #3096)
 *
 * The controls for one task on the fulfilment board: the self-serve checkbox
 * and the `Assign to…` / `Move to…` menu (both from
 * `FulfillmentAssignmentControls`, shared with the task detail's Packer card),
 * then the server-declared action set behind a `⋮` trigger. #3426's drag
 * between lanes stays an additive shortcut elsewhere; the menu is the real,
 * keyboard-reachable path.
 *
 * ## It renders `FulfillmentTaskActions`, and that reverses an earlier call
 *
 * This file used to argue that a staffing surface is not an execution one and
 * should therefore render none of those controls, citing ADR-074. ADR-074 is
 * about the `assignedToUserId` FIELD and says nothing about screen topology,
 * and the split produced a one-way gate: this screen offered Hold and had no
 * way to take a hold off. The rule that replaces it: a screen offers the
 * inverse of what it offers, so the full `supportedActions` set renders —
 * whatever the server says is legal on this task right now, including an
 * action this build has no copy for.
 *
 * ## The action set lives behind an overflow menu, not inline
 *
 * Up to five inline buttons made every card a different height and the rows
 * stopped lining up. The mockup's own answer is `.lane-card__menu`: a single
 * trigger per card, a popover holding the rest. Every one of
 * `FulfillmentTaskActions`' callbacks is wrapped to close the menu first: a
 * menu that stays open after the action it held was clicked would still cover
 * the row underneath it.
 *
 * ## The `⋮` slot is always there (#3096)
 *
 * A closed or cancelled task carries no action, and with no trigger the
 * checkbox and the menu button shifted ~35 px right on exactly those rows —
 * the columns of a lane no longer lined up. An empty slot of the trigger's
 * width keeps them still. It is `aria-hidden` and focusable by nothing, so it
 * costs a screen reader nothing.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { useState, type ReactElement } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import type { PackerSummary } from '../../users';
import type { FulfillmentTask, FulfillmentTaskHold } from '../api/fulfillment.types';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';
import { FulfillmentAssignmentControls } from './fulfillment-assignment-controls';
import { FulfillmentTaskActions } from './fulfillment-task-actions';

export interface AssignPackingWorkActionsProps {
  task: FulfillmentTask;
  packers: readonly PackerSummary[];
  /** Tasks per packer on this page, shown beside each packer in the menu. */
  queueCounts?: ReadonlyMap<string, number>;
  /** Whether the staffing controls should render at all. */
  visible: boolean;
  /** Rendered but disabled — the demo-viewer state (#1615). */
  readOnly: boolean;
  busy: boolean;
  onMoveTo: (userId: string | null) => void;
  onToggleSelfServe: (selfServeEligible: boolean) => void;
  /** An action with no dialog — the server named it, we just send it. */
  onInvoke: (action: string) => void;
  onHold: () => void;
  onReleaseHold: (hold: FulfillmentTaskHold) => void;
  onForceCancel: () => void;
}

export function AssignPackingWorkActions({
  task,
  packers,
  queueCounts,
  visible,
  readOnly,
  busy,
  onMoveTo,
  onToggleSelfServe,
  onInvoke,
  onHold,
  onReleaseHold,
  onForceCancel,
}: AssignPackingWorkActionsProps): ReactElement | null {
  // Above the early return — a hook cannot be called conditionally, and
  // `visible` can flip between renders of the SAME task row.
  const [menuOpen, setMenuOpen] = useState(false);

  if (!visible) return null;

  // Rendered but disabled on demoReadOnly — never hidden. Hiding a legal
  // action set would say "nothing is legal here" when the truth is "you may
  // not do it".
  const hasActions = task.supportedActions.length > 0;

  return (
    <div className="assign-packing-work-actions">
      <FulfillmentAssignmentControls
        task={task}
        packers={packers}
        queueCounts={queueCounts}
        busy={busy}
        readOnly={readOnly}
        onMoveTo={onMoveTo}
        onToggleSelfServe={onToggleSelfServe}
        order="checkbox-first"
      />

      {hasActions ? (
        <Popover open={menuOpen} onOpenChange={setMenuOpen} dismissOnViewportChange>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="assign-packing-work-card__menu-trigger"
              aria-label={ASSIGN_PACKING_WORK_COPY.row.moreActionsLabel}
            >
              ⋮
            </button>
          </PopoverTrigger>
          <PopoverContent className="assign-packing-work-card__menu" align="end">
            <FulfillmentTaskActions
              task={task}
              visible={visible}
              readOnly={readOnly}
              busy={busy}
              onInvoke={(action) => {
                setMenuOpen(false);
                onInvoke(action);
              }}
              onHold={() => {
                setMenuOpen(false);
                onHold();
              }}
              onReleaseHold={(hold) => {
                setMenuOpen(false);
                onReleaseHold(hold);
              }}
              onForceCancel={() => {
                setMenuOpen(false);
                onForceCancel();
              }}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <span
          className="assign-packing-work-card__menu-slot"
          aria-hidden="true"
          data-testid="assign-packing-work-menu-slot"
        />
      )}
    </div>
  );
}
