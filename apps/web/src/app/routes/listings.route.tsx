import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const listingsListCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'listings' },
};
const listingDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'listing' },
};
const bulkWizardCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'bulkListing' },
};
const bulkBatchCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'bulkBatch' },
};

export const listingsRoute: RouteObject = {
  path: 'listings',
  children: [
    {
      index: true,
      handle: listingsListCrumb,
      lazy: async () => {
        const { ListingsListPage } = await import('../../pages/listings/listings-list-page');
        return { Component: ListingsListPage };
      },
    },
    {
      // #740 — bulk listing wizard. Path is split so the dynamic `:id` route
      // below doesn't intercept the literal `bulk-create` segment.
      path: 'bulk-create/wizard',
      handle: bulkWizardCrumb,
      lazy: async () => {
        const { BulkCreateWizardPage } = await import(
          '../../pages/listings/bulk-create-wizard-page'
        );
        return { Component: BulkCreateWizardPage };
      },
    },
    {
      // #741 — bulk batch progress page.
      path: 'bulk-batches/:batchId',
      handle: bulkBatchCrumb,
      lazy: async () => {
        const { BulkBatchProgressPage } = await import(
          '../../pages/listings/bulk-batch-progress-page'
        );
        return { Component: BulkBatchProgressPage };
      },
    },
    {
      path: ':id',
      handle: listingDetailCrumb,
      lazy: async () => {
        const { ListingDetailPage } = await import('../../pages/listings/listing-detail-page');
        return { Component: ListingDetailPage };
      },
    },
  ],
};
