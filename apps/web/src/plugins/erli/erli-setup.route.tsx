/**
 * Route: `/connections/new/erli` — guided Erli wizard.
 *
 * @module plugins/erli
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getErliMessages } from './messages';

export const erliSetupRoute: RouteObject = {
  path: 'connections/new/erli',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getErliMessages().erliSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ErliSetupPage } = await import('../../pages/connections/erli-setup-page');
    return { Component: ErliSetupPage };
  },
};
