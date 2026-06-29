/**
 * Route: `/connections/new/ksef` — guided KSeF (Polish e-invoicing) wizard.
 *
 * @module plugins/ksef
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const ksefSetupRoute: RouteObject = {
  path: 'connections/new/ksef',
  handle: { crumb: { group: 'Platform', title: 'Connect KSeF' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { KsefSetupPage } = await import('../../pages/connections/ksef-setup-page');
    return { Component: KsefSetupPage };
  },
};
