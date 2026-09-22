/**
 * Assign Packing Work row controls (#3340, ADR-074)
 *
 * The click-only staffing controls for one task: a "Move to" select (the
 * whole reassignment surface — no drag-and-drop via THIS control; #3426
 * added the additive drag shortcut elsewhere), a self-serve checkbox, and a
 * Hold button reusing the existing `FulfillmentTaskActionDialog`. This is a
 * STAFFING surface, not an execution one — it renders none of
 * `FulfillmentTaskActions`' claim/accept/close controls, because
 * pre-assignment is orthogonal to the handshake those act on (ADR-074).
 *
 * The select fires on change — click-only means one click plus one selection,
 * never a second "confirm" step, matching the mockup's own accessibility
 * argument that the menu IS the real interaction path.
 *
 * ## The checkbox and Hold render ONLY on an unassigned task (#3429)
 *
 * Verified against the mockup's own `makeCard(item, isUnassigned)`: every
 * static packer-lane card in the demo markup carries a "Move to…" button
 * alone, and the self-serve checkbox + Hold button are emitted only when
 * `isUnassigned` is true — i.e. only for cards built from the Unassigned
 * lane's own pool. `task.assignedToUserId === null` is exactly that
 * condition (the pinned lane's own membership test, `groupTasksByPacker`'s),
 * so no extra "which lane is this" prop is threaded in — the task already
 * carries the answer. The "Move to" select is unaffected and stays on every
 * task in every lane, matching the mockup's own button on every card.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ChangeEvent, ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { Select } from '../../../shared/ui/select';
import type { PackerSummary } from '../../users';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';

const UNASSIGNED_OPTION_VALUE = '';

export interface AssignPackingWorkActionsProps {
  task: FulfillmentTask;
  packers: readonly PackerSummary[];
  /** Whether the staffing controls should render at all. */
  visible: boolean;
  /** Rendered but disabled — the demo-viewer state (#1615). */
  readOnly: boolean;
  busy: boolean;
  onMoveTo: (userId: string | null) => void;
  onToggleSelfServe: (selfServeEligible: boolean) => void;
  onHold: () => void;
}

export function AssignPackingWorkActions({
  task,
  packers,
  visible,
  readOnly,
  busy,
  onMoveTo,
  onToggleSelfServe,
  onHold,
}: AssignPackingWorkActionsProps): ReactElement | null {
  if (!visible) return null;

  const disabled = busy || readOnly;
  const isUnassigned = task.assignedToUserId === null;

  const handleMoveTo = (event: ChangeEvent<HTMLSelectElement>): void => {
    const value = event.target.value;
    onMoveTo(value === UNASSIGNED_OPTION_VALUE ? null : value);
  };

  return (
    <div className="assign-packing-work-actions">
      <Select
        aria-label={ASSIGN_PACKING_WORK_COPY.row.moveToLabel}
        value={task.assignedToUserId ?? UNASSIGNED_OPTION_VALUE}
        disabled={disabled}
        onChange={handleMoveTo}
      >
        <option value={UNASSIGNED_OPTION_VALUE}>
          {ASSIGN_PACKING_WORK_COPY.row.moveToUnassigned}
        </option>
        {packers.map((packer) => (
          <option key={packer.id} value={packer.id}>
            {packer.username}
          </option>
        ))}
      </Select>

      {isUnassigned ? (
        <>
          <label className="assign-packing-work-actions__self-serve">
            <input
              type="checkbox"
              checked={task.selfServeEligible}
              disabled={disabled}
              onChange={(event) => {
                onToggleSelfServe(event.target.checked);
              }}
            />
            {ASSIGN_PACKING_WORK_COPY.row.selfServeLabel}
          </label>

          <Button tone="secondary" disabled={disabled} onClick={onHold}>
            {ASSIGN_PACKING_WORK_COPY.row.hold}
          </Button>
        </>
      ) : null}
    </div>
  );
}
