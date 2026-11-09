/**
 * Route: `/connections/new/infakt` — guided inFakt wizard.
 *
 * @module plugins/infakt
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getInfaktMessages } from './messages';

export const infaktSetupRoute: RouteObject = {
  path: 'connections/new/infakt',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getInfaktMessages().infaktSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { InfaktSetupPage } = await import('./components/infakt-setup-page');
    return { Component: InfaktSetupPage };
  },
};
