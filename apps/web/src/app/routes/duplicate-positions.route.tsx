import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const duplicatePositionsCrumb: RouteCrumbHandle = {
  crumb: { group: 'Diagnostics', title: 'Duplicate stock positions' },
};

export const duplicatePositionsRoute: RouteObject = {
  path: 'duplicate-positions',
  children: [
    {
      index: true,
      handle: duplicatePositionsCrumb,
      lazy: async () => {
        const { DuplicatePositionsPage } = await import(
          '../../pages/inventory/duplicate-positions-page'
        );
        // Backend is @Roles('admin')-gated. The page gates itself (its own
        // docblock explains why: it renders an access-denied state INSIDE
        // its own PageLayout, and its query hooks are `enabled: isAdmin`,
        // which is what actually prevents the 403 round-trip). A second,
        // route-level guard here (`RequireAdmin`, #3261 review IMPORTANT
        // finding) made the page's own denial state unreachable dead code
        // and rendered a frame-less denial with no PageLayout — removed.
        return { Component: DuplicatePositionsPage };
      },
    },
  ],
};
