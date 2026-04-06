import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { JobStatus } from '../api/sync-jobs.types';

const STATUS_TONE: Record<JobStatus, StatusBadgeTone> = {
  queued: 'info',
  running: 'review',
  succeeded: 'success',
  failed: 'warning',
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
