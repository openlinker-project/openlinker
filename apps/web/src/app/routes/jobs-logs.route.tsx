import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const jobsListCrumb: RouteCrumbHandle = {
  crumb: { group: 'diagnostics', page: 'jobsLogs' },
};
const jobDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'diagnostics', page: 'job' },
};

export const jobsLogsRoute: RouteObject = {
  path: 'jobs-logs',
  children: [
    {
      index: true,
      handle: jobsListCrumb,
      lazy: async () => {
        const { SyncJobsPage } = await import('../../pages/sync-jobs/sync-jobs-page');
        return { Component: SyncJobsPage };
      },
    },
    {
      path: ':id',
      handle: jobDetailCrumb,
      lazy: async () => {
        const { SyncJobDetailPage } = await import(
          '../../pages/sync-jobs/sync-job-detail-page'
        );
        return { Component: SyncJobDetailPage };
      },
    },
  ],
};
