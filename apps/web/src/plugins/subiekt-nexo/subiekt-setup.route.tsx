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

export const subiektNexoSetupRoute: RouteObject = {
  path: 'connections/new/subiekt-nexo',
  handle: { crumb: { group: 'Platform', title: 'Connect Subiekt nexo' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SubiektSetupPage } = await import('../../pages/connections/subiekt-setup-page');
    return {
      Component: () => (
        <SubiektSetupPage identity={SUBIEKT_NEXO_IDENTITY} />
      ),
    };
  },
};
