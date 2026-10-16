/**
 * The "packers cannot see this parcel" warning (#3763)
 *
 * Rendered by the task card and the task detail page for a task that is stuck
 * before acceptance or was refused. It is a warning, not an error: the task is
 * intact, it just has not reached the pack bench, which lists accepted work
 * only. Renders nothing for every other state.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { formatAcceptanceWait, type TaskAcceptance } from '../lib/fulfillment-task-acceptance';
import { TASK_ACCEPTANCE_COPY } from '../lib/fulfillment-task.copy';

export interface FulfillmentTaskAcceptanceNoticeProps {
  acceptance: TaskAcceptance;
  /** Where accepted work appears; see `OWN_PACK_BENCH_NAME`. */
  where: string;
}

export function FulfillmentTaskAcceptanceNotice({
  acceptance,
  where,
}: FulfillmentTaskAcceptanceNoticeProps): ReactElement | null {
  if (acceptance.kind === 'stuck') {
    return (
      <Alert tone="warning" density="compact" title={TASK_ACCEPTANCE_COPY.stuckTitle(where)}>
        {TASK_ACCEPTANCE_COPY.stuck(where, formatAcceptanceWait(acceptance.waitedMs))}
      </Alert>
    );
  }
  if (acceptance.kind === 'refused') {
    return (
      <Alert tone="warning" density="compact" title={TASK_ACCEPTANCE_COPY.refusedTitle(where)}>
        {TASK_ACCEPTANCE_COPY.refused(where)}
      </Alert>
    );
  }
  return null;
}
