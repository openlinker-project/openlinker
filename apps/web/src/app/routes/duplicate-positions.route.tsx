import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';
import { RequireAdmin } from './require-admin';

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
        // Backend is @Roles('admin')-gated; RequireAdmin keeps a non-admin
        // session from ever firing the page's queries and hitting a raw 403
        // ErrorState (see require-admin.tsx's docblock).
        function Guarded(): ReactElement {
          return (
            <RequireAdmin>
              <DuplicatePositionsPage />
            </RequireAdmin>
          );
        }
        return { Component: Guarded };
      },
    },
  ],
};
