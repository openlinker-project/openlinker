/**
 * The "not accepted" reason under "Why it's stuck" (#3763)
 *
 * Rendered by the task detail page, beside the hold banners, for a task that
 * is stuck before acceptance or was not accepted: the pack bench lists
 * accepted work only, so packers cannot see it. A warning, not an error - the
 * task is intact. Renders nothing for every other state.
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
      <Alert tone="warning" density="compact" title={TASK_ACCEPTANCE_COPY.stuckTitle}>
        {TASK_ACCEPTANCE_COPY.stuckBody(formatAcceptanceWait(acceptance.waitedMs), where)}
      </Alert>
    );
  }
  if (acceptance.kind === 'refused') {
    return (
      <Alert tone="warning" density="compact" title={TASK_ACCEPTANCE_COPY.refusedTitle}>
        {TASK_ACCEPTANCE_COPY.refusedBody(where)}
      </Alert>
    );
  }
  return null;
}
