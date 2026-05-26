/**
 * Shipments route (#770)
 *
 * Top-level `/shipments` cross-order rollup list. Lazy-loaded page chunk;
 * carries its own breadcrumb (Operations › Shipments).
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const shipmentsRoute: RouteObject = {
  path: 'shipments',
  handle: { crumb: { group: 'Operations', title: 'Shipments' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ShipmentsPage } = await import('../../pages/shipments/shipments-page');
    return { Component: ShipmentsPage };
  },
};
