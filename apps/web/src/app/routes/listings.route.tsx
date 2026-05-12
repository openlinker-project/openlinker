import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const listingsListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Listings' },
};
const listingDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Listing' },
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
      path: ':id',
      handle: listingDetailCrumb,
      lazy: async () => {
        const { ListingDetailPage } = await import('../../pages/listings/listing-detail-page');
        return { Component: ListingDetailPage };
      },
    },
  ],
};
