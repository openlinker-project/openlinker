import type { RouteObject } from 'react-router-dom';
import { BATCH_SCREEN_ROUTE_PATH } from '../../features/sales-documents';
import type { RouteCrumbHandle } from '../nav-registry.types';

/** #3584: the batch-issuing screen for one connection (mockup M15). */
export const salesDocumentBatchRoute: RouteObject = {
  path: BATCH_SCREEN_ROUTE_PATH,
  handle: { crumb: { group: 'settings', page: 'salesDocumentBatch' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SalesDocumentBatchPage } = await import(
      '../../pages/settings/sales-document-batch-page'
    );
    return { Component: SalesDocumentBatchPage };
  },
};
