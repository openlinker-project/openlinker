import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const inventoryMovementsRoute: RouteObject = {
  path: 'inventory/movements',
  handle: { crumb: { group: 'Operations', title: 'Stock movements' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { InventoryMovementsPage } = await import('../../pages/inventory/inventory-movements-page');
    return { Component: InventoryMovementsPage };
  },
};
