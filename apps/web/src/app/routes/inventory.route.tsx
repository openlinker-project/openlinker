import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const inventoryListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Inventory' },
};
const inventoryDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Inventory item' },
};

export const inventoryRoute: RouteObject = {
  path: 'inventory',
  children: [
    {
      index: true,
      handle: inventoryListCrumb,
      lazy: async () => {
        const { InventoryListPage } = await import('../../pages/inventory/inventory-list-page');
        return { Component: InventoryListPage };
      },
    },
    {
      path: ':id',
      handle: inventoryDetailCrumb,
      lazy: async () => {
        const { InventoryDetailPage } = await import(
          '../../pages/inventory/inventory-detail-page'
        );
        return { Component: InventoryDetailPage };
      },
    },
  ],
};
