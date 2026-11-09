/**
 * Route: `/connections/new/inpost` — guided InPost (ShipX) wizard.
 *
 * @module plugins/inpost
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getInpostMessages } from './messages';

export const inpostSetupRoute: RouteObject = {
  path: 'connections/new/inpost',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getInpostMessages().inpostSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { InpostSetupPage } = await import('../../pages/connections/inpost-setup-page');
    return { Component: InpostSetupPage };
  },
};
