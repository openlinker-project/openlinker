/**
 * Route: `/connections/new/eparagony` - guided eparagony.pl wizard (#1911).
 *
 * @module plugins/eparagony
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getEparagonyMessages } from './messages';

export const eparagonySetupRoute: RouteObject = {
  path: 'connections/new/eparagony',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getEparagonyMessages().eparagonySetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { EparagonySetupPage } = await import('./components/eparagony-setup-page');
    return { Component: EparagonySetupPage };
  },
};
