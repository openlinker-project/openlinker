/**
 * Route: `/connections/new/subiekt-nexo` — guided Subiekt nexo wizard.
 *
 * The page is shared with the Subiekt GT route; each passes its OWN product
 * identity, because the two speak different bridges and a connection created
 * under the wrong one points at an adapter that cannot talk to it.
 *
 * @module plugins/subiekt-nexo
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { SUBIEKT_NEXO_IDENTITY } from '../../features/connections';
import { getSubiektNexoMessages } from './messages';

export const subiektNexoSetupRoute: RouteObject = {
  path: 'connections/new/subiekt-nexo',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getSubiektNexoMessages().subiektSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SubiektSetupPage } = await import('../../pages/connections/subiekt-setup-page');
    return {
      Component: () => (
        <SubiektSetupPage identity={SUBIEKT_NEXO_IDENTITY} />
      ),
    };
  },
};
