import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const inventoryListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Inventory' },
};

/**
 * List-only — the former `:id` detail child was removed (#1305/#1609):
 * `product-detail-page.tsx` now fully subsumes per-item stock detail via its
 * per-variant Available/Reserved table + inline "Listings using this stock".
 * This index route stays as the only cross-product stock-overview surface
 * (filter/sort/paginate across the whole catalog) — the merged product-detail
 * view is single-product only and doesn't replace that.
 */
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
  ],
};
