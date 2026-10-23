import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const inventoryLocationsRoute: RouteObject = {
  path: 'inventory/locations',
  handle: { crumb: { group: 'Platform', title: 'Inventory locations' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { InventoryLocationsPage } = await import(
      '../../pages/inventory/inventory-locations-page'
    );
    return { Component: InventoryLocationsPage };
  },
};
