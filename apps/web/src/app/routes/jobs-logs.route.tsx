import type { RouteObject } from 'react-router-dom';
import { ModulePlaceholderPage } from '../../pages/placeholders/module-placeholder-page';

export const jobsLogsRoute: RouteObject = {
  path: 'jobs-logs',
  element: (
    <ModulePlaceholderPage
      eyebrow="Operations"
      title="Jobs and logs workspace"
      moduleName="Jobs & Logs"
      description="Background execution visibility, retry triage, and diagnostic log drilldowns will be grouped in this module."
    />
  ),
};
