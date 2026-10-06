/**
 * The two staffing controls for one task (#3096, ADR-074)
 *
 * The mockup's `Assign to…` / `Move to…` button and its menu of packers, plus
 * the self-serve checkbox. Extracted from the assign board's row so the task
 * detail's Packer card renders the SAME controls — one way to staff a task,
 * whichever screen it is staffed from.
 *
 * ## A menu, not a native select
 *
 * The board used to carry a native "Move to" `<select>`, whose closed state
 * reads "Unassigned ▾" on every pooled row — a value, not a verb, and the
 * widest control on the row. The mockup's answer is a button that says what
 * the click does from where the task is now, opening a menu of packers with
 * "Pull back to Unassigned" below a separator. `DropdownMenu` keeps the
 * keyboard and screen-reader contract the select had (Radix menu semantics:
 * arrow keys, Enter, Escape), so nothing is lost for a keyboard user, and drag
 * on the board stays an additive shortcut on top of it.
 *
 * Each packer entry may carry its queue count on THIS page (`queueCounts`) —
 * the board supplies it from the lanes it already grouped; the detail has no
 * page of tasks and passes none rather than a number fetched for one menu.
 *
 * ## The checkbox renders on every task
 *
 * Assignment is ADVISORY (ADR-074): an assigned parcel stays claimable by any
 * packer, and unticking this is the ADR's own escape hatch for a hard
 * assignment. Its label changes with the task's state because the question
 * does.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { Button } from '../../../shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../shared/ui/dropdown-menu';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import type { PackerSummary } from '../../users';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';

const ROW_COPY = ASSIGN_PACKING_WORK_COPY.row;

export interface FulfillmentAssignmentControlsProps {
  task: FulfillmentTask;
  packers: readonly PackerSummary[];
  /** Tasks per packer on the current page, for "Marta Kowalczyk (2)". Omit for no counts. */
  queueCounts?: ReadonlyMap<string, number>;
  /** An assignment write is in flight for this task. */
  busy: boolean;
  /** Rendered but disabled — the demo-viewer state (#1615). */
  readOnly: boolean;
  onMoveTo: (userId: string | null) => void;
  onToggleSelfServe: (selfServeEligible: boolean) => void;
  /** `md` is the detail card's 32 px button; the board row keeps the 28 px one. */
  size?: 'sm' | 'md';
  /** Which control goes first. The board row puts the checkbox first, as the mockup does. */
  order?: 'menu-first' | 'checkbox-first';
}

/** The menu's trigger label: what a click does from where the task is now. */
export function assignmentTriggerLabel(task: FulfillmentTask): string {
  return task.assignedToUserId === null ? ROW_COPY.assignTo : ROW_COPY.moveTo;
}

export function FulfillmentAssignmentControls({
  task,
  packers,
  queueCounts,
  busy,
  readOnly,
  onMoveTo,
  onToggleSelfServe,
  size = 'sm',
  order = 'menu-first',
}: FulfillmentAssignmentControlsProps): ReactElement {
  const disabled = busy || readOnly;
  const isUnassigned = task.assignedToUserId === null;
  // The task's own packer is not a destination; "move to where it already is"
  // would send a write that changes nothing.
  const destinations = packers.filter((packer) => packer.id !== task.assignedToUserId);

  const menu = (
    <ReadOnlyLock active={readOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button
            tone="secondary"
            className={size === 'sm' ? 'button--sm fulfilment-assignment__trigger' : 'fulfilment-assignment__trigger'}
            // No `aria-label`: the visible verb IS the accessible name (WCAG
            // 2.5.3, label in name), and the row around it names the task.
            disabled={disabled}
          >
            {assignmentTriggerLabel(task)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="fulfilment-assignment__menu">
          {destinations.map((packer) => {
            const queued = queueCounts?.get(packer.id);
            return (
              <DropdownMenuItem
                key={packer.id}
                onSelect={() => {
                  onMoveTo(packer.id);
                }}
              >
                {queued === undefined ? packer.username : ROW_COPY.packerWithQueue(packer.username, queued)}
              </DropdownMenuItem>
            );
          })}
          {destinations.length === 0 ? (
            <DropdownMenuItem disabled>{ROW_COPY.noPackers}</DropdownMenuItem>
          ) : null}
          {isUnassigned ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="fulfilment-assignment__pull-back"
                onSelect={() => {
                  onMoveTo(null);
                }}
              >
                <span aria-hidden="true">↩ </span>
                {ROW_COPY.pullBack}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </ReadOnlyLock>
  );

  const checkbox = (
    <label className="assign-packing-work-actions__self-serve">
      <input
        type="checkbox"
        checked={task.selfServeEligible}
        disabled={disabled}
        onChange={(event) => {
          onToggleSelfServe(event.target.checked);
        }}
      />
      {isUnassigned ? ROW_COPY.selfServeLabel : ROW_COPY.selfServeAssignedLabel}
    </label>
  );

  return order === 'checkbox-first' ? (
    <>
      {checkbox}
      {menu}
    </>
  ) : (
    <>
      {menu}
      {checkbox}
    </>
  );
}
