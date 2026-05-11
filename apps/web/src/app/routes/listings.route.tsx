import type { RouteObject } from 'react-router-dom';

export const listingsRoute: RouteObject = {
  path: 'listings',
  children: [
    {
      index: true,
      lazy: async () => {
        const { ListingsListPage } = await import('../../pages/listings/listings-list-page');
        return { Component: ListingsListPage };
      },
    },
    {
      path: ':id',
      lazy: async () => {
        const { ListingDetailPage } = await import('../../pages/listings/listing-detail-page');
        return { Component: ListingDetailPage };
      },
    },
  ],
};
