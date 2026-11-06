/**
 * Route: `/connections/new/shoper` — guided Shoper wizard.
 *
 * @module plugins/shoper
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getShoperMessages } from './messages';

export const shoperSetupRoute: RouteObject = {
  path: 'connections/new/shoper',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getShoperMessages().shoperSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ShoperSetupPage } = await import('../../pages/connections/shoper-setup-page');
    return { Component: ShoperSetupPage };
  },
};
