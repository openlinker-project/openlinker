/**
 * Sync Job Status Badge
 *
 * Renders a semantic status badge for a sync job status value.
 * Tone mapping mirrors the job lifecycle: queued → info, running → review,
 * succeeded → success, dead → error.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { JobStatus } from '../api/sync-jobs.types';

const STATUS_TONE: Record<JobStatus, StatusBadgeTone> = {
  queued: 'info',
  running: 'review',
  succeeded: 'success',
  dead: 'error',
};

interface SyncJobStatusBadgeProps {
  status: string;
}

export function SyncJobStatusBadge({ status }: SyncJobStatusBadgeProps): ReactElement {
  const tone: StatusBadgeTone = STATUS_TONE[status as JobStatus] ?? 'neutral';
  return (
    <StatusBadge tone={tone} withDot>
      {status}
    </StatusBadge>
  );
}
