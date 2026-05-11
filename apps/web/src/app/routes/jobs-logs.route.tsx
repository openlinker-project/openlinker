import type { RouteObject } from 'react-router-dom';

export const jobsLogsRoute: RouteObject = {
  path: 'jobs-logs',
  children: [
    {
      index: true,
      lazy: async () => {
        const { SyncJobsPage } = await import('../../pages/sync-jobs/sync-jobs-page');
        return { Component: SyncJobsPage };
      },
    },
    {
      path: ':id',
      lazy: async () => {
        const { SyncJobDetailPage } = await import(
          '../../pages/sync-jobs/sync-job-detail-page'
        );
        return { Component: SyncJobDetailPage };
      },
    },
  ],
};
