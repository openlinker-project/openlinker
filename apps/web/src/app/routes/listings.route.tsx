import type { RouteObject } from 'react-router-dom';
import { ListingsListPage } from '../../pages/listings/listings-list-page';
import { ListingDetailPage } from '../../pages/listings/listing-detail-page';

export const listingsRoute: RouteObject = {
  path: 'listings',
  children: [
    { index: true, element: <ListingsListPage /> },
    { path: ':id', element: <ListingDetailPage /> },
  ],
};
