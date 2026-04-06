import type { RouteObject } from 'react-router-dom';
import { SyncJobsPage } from '../../pages/sync-jobs/sync-jobs-page';
import { SyncJobDetailPage } from '../../pages/sync-jobs/sync-job-detail-page';

export const jobsLogsRoute: RouteObject = {
  path: 'jobs-logs',
  children: [
    { index: true, element: <SyncJobsPage /> },
    { path: ':id', element: <SyncJobDetailPage /> },
  ],
};
