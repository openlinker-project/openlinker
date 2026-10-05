/**
 * The Packer card on the task detail (#3096)
 *
 * Who packs this parcel, and the controls to change it — the first card in
 * the detail's right-hand column, drawn from `assign-packing-work.html`'s lane
 * head and row: an initials avatar with the packer's station and presence, or
 * the pool's ✳ with how long the task has waited, then the same `Assign to…`
 * / `Move to…` menu and self-serve checkbox the board offers.
 *
 * Until this card the assignment PATCH had exactly one UI — the board — so an
 * operator who opened a task to see why it was stuck had to go back to the
 * board to staff it.
 *
 * ## Same controls, same runner, as the board
 *
 * `FulfillmentAssignmentControls` and `useFulfillmentAssignmentRunner` are the
 * board's own, so a move made here sends the same body (with the version this
 * card was RENDERED with), reports through the same toast, and reads a 409 the
 * same way. The mutation invalidates the whole `['fulfillment']` prefix, so
 * this page's own detail read refreshes after a write without a subscription.
 *
 * ## No queue counts here
 *
 * The board puts "(2)" beside each packer from the page of tasks it already
 * holds. This page holds one task; a count fetched for one menu would be a
 * second read for a number the board already shows, so the menu lists names.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { formatInitials } from '../../../shared/format/format-initials';
import { Alert } from '../../../shared/ui/alert';
import { DetailSection } from '../../../shared/ui/detail-section';
import { usePackersQuery } from '../../users';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { useFulfillmentAssignmentRunner } from '../hooks/use-fulfillment-assignment-runner';
import { formatUnassignedAge } from '../lib/assign-packing-work-duration';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';
import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';
import { FulfillmentAssignmentControls } from './fulfillment-assignment-controls';

const COPY = FULFILLMENT_WORK_DETAIL_COPY;

export interface FulfillmentWorkPackerSectionProps {
  task: FulfillmentTask;
  /** Whether the staffing controls render at all (`useWriteAccess().visible`). */
  canStaff: boolean;
  /** Rendered but disabled — the demo-viewer state (#1615). */
  readOnly: boolean;
}

export function FulfillmentWorkPackerSection({
  task,
  canStaff,
  readOnly,
}: FulfillmentWorkPackerSectionProps): ReactElement {
  const packersQuery = usePackersQuery();
  const assignment = useFulfillmentAssignmentRunner();
  const packers = packersQuery.data?.packers ?? [];
  const assignedId = task.assignedToUserId;
  const packer = assignedId === null ? null : (packers.find((p) => p.id === assignedId) ?? null);

  let holder: ReactElement;
  if (assignedId === null) {
    const age = formatUnassignedAge(task.unassignedSince ?? null);
    holder = (
      <>
        <span className="assign-packing-work-lane__icon" aria-hidden="true">
          ✳
        </span>
        <div className="fulfilment-work-packer__identity">
          <p className="fulfilment-work-packer__name">{COPY.packer.unassigned}</p>
          <p className="fulfilment-work-packer__sub">
            {age === null ? COPY.packer.waitingUnknown : COPY.packer.waiting(age)}
          </p>
        </div>
      </>
    );
  } else {
    // While the roster loads the name is not known yet; an off-roster id
    // (deactivated, or no longer a packer) says so rather than vanishing.
    const name = packer?.username ?? (packersQuery.isPending ? '' : ASSIGN_PACKING_WORK_COPY.lane.offRosterTitle);
    holder = (
      <>
        <span className="assign-packing-work-lane__avatar" aria-hidden="true">
          {packer === null ? '?' : formatInitials(packer.username)}
        </span>
        <div className="fulfilment-work-packer__identity">
          <p className="fulfilment-work-packer__name">{name}</p>
          {packer === null ? null : (
            <p className="fulfilment-work-packer__sub">
              {ASSIGN_PACKING_WORK_COPY.lane.packerSubtitle(packer)}
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <DetailSection
      title={COPY.sections.packer}
      className="fulfilment-work-packer"
      aria-label={COPY.sections.packer}
      aria-busy={assignment.busyTaskId === task.id}
    >
      <div className="fulfilment-work-packer__holder">{holder}</div>
      {canStaff ? (
        <div className="fulfilment-work-packer__controls">
          <FulfillmentAssignmentControls
            task={task}
            packers={packers}
            busy={assignment.busyTaskId === task.id}
            readOnly={readOnly}
            size="md"
            order="menu-first"
            onMoveTo={(userId) => {
              assignment.setAssignment(task, { assignedToUserId: userId });
            }}
            onToggleSelfServe={(selfServeEligible) => {
              assignment.setAssignment(task, { selfServeEligible });
            }}
          />
        </div>
      ) : null}
      {canStaff && packersQuery.isError ? (
        <Alert tone="warning" density="compact">
          {COPY.packer.rosterError}
        </Alert>
      ) : null}
    </DetailSection>
  );
}
