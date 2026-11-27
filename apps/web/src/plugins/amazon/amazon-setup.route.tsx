/**
 * Route: `/connections/new/amazon` - guided Amazon connection form (#4186).
 *
 * @module plugins/amazon
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getAmazonMessages } from './messages';

export const amazonSetupRoute: RouteObject = {
  path: 'connections/new/amazon',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getAmazonMessages().setup.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AmazonSetupPage } = await import('../../pages/connections/amazon-setup-page');
    return { Component: AmazonSetupPage };
  },
};
