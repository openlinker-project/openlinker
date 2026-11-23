/**
 * Route: `/connections/new/empik` - guided Empik Marketplace wizard.
 *
 * @module plugins/empik
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getEmpikMessages } from './messages';

export const empikSetupRoute: RouteObject = {
  path: 'connections/new/empik',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getEmpikMessages().empikSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { EmpikSetupPage } = await import('../../pages/connections/empik-setup-page');
    return { Component: EmpikSetupPage };
  },
};
