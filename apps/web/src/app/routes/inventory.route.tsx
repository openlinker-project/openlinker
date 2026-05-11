import type { RouteObject } from 'react-router-dom';

export const inventoryRoute: RouteObject = {
  path: 'inventory',
  children: [
    {
      index: true,
      lazy: async () => {
        const { InventoryListPage } = await import('../../pages/inventory/inventory-list-page');
        return { Component: InventoryListPage };
      },
    },
    {
      path: ':id',
      lazy: async () => {
        const { InventoryDetailPage } = await import(
          '../../pages/inventory/inventory-detail-page'
        );
        return { Component: InventoryDetailPage };
      },
    },
  ],
};
