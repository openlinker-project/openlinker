import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

/**
 * Dev UI route (#775)
 *
 * Hidden design-system page available at `/dev/ui`. Not surfaced in the
 * primary nav — discoverable only by URL. Three tabs: Brandbook,
 * Primitives, Patterns. Doubles as the visual regression surface when
 * we tweak tokens later.
 */
export const devUiRoute: RouteObject = {
  path: 'dev/ui',
  handle: { crumb: { group: 'Development', title: 'Design System' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { DevUiPage } = await import('../../pages/dev-ui/dev-ui-page');
    return { Component: DevUiPage };
  },
};
