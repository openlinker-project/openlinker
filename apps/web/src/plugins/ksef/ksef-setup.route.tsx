/**
 * Route: `/connections/new/ksef` — guided KSeF (Polish e-invoicing) wizard.
 *
 * @module plugins/ksef
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getKsefMessages } from './messages';

export const ksefSetupRoute: RouteObject = {
  path: 'connections/new/ksef',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getKsefMessages().ksefSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { KsefSetupPage } = await import('./components/ksef-setup-page');
    return { Component: KsefSetupPage };
  },
};
