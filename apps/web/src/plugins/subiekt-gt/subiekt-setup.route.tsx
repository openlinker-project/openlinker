/**
 * Route: `/connections/new/subiekt-gt` — guided Subiekt GT wizard (#1199).
 *
 * The page is shared with the Subiekt nexo route; each passes its OWN product
 * identity, because the two speak different bridges and a connection created
 * under the wrong one points at an adapter that cannot talk to it.
 *
 * @module plugins/subiekt-gt
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { SUBIEKT_GT_IDENTITY } from '../../features/connections/components/subiekt-setup.schema';

export const subiektSetupRoute: RouteObject = {
  path: 'connections/new/subiekt-gt',
  handle: { crumb: { group: 'Platform', title: 'Connect Subiekt GT' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SubiektSetupPage } = await import('../../pages/connections/subiekt-setup-page');
    return {
      Component: () => (
        <SubiektSetupPage identity={SUBIEKT_GT_IDENTITY} productName="Subiekt GT" />
      ),
    };
  },
};
