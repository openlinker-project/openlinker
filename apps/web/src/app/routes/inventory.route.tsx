import type { RouteObject } from 'react-router-dom';
import { InventoryListPage } from '../../pages/inventory/inventory-list-page';
import { InventoryDetailPage } from '../../pages/inventory/inventory-detail-page';

export const inventoryRoute: RouteObject = {
  path: 'inventory',
  children: [
    { index: true, element: <InventoryListPage /> },
    { path: ':id', element: <InventoryDetailPage /> },
  ],
};
