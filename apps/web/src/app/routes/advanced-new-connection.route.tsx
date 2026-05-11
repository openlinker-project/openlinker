/**
 * Route: `/connections/new/advanced` — raw connection form fallback.
 */
import type { RouteObject } from 'react-router-dom';

export const advancedNewConnectionRoute: RouteObject = {
  path: 'connections/new/advanced',
  lazy: async () => {
    const { AdvancedNewConnectionPage } = await import(
      '../../pages/connections/advanced-new-connection-page'
    );
    return { Component: AdvancedNewConnectionPage };
  },
};
