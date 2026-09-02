/**
 * Returns route (#2335, detail added by #2336)
 *
 * `/returns` (the list) and `/returns/:returnId` (the detail). Both are lazy
 * page chunks and both carry their own breadcrumb — the crumb-contract test
 * asserts every lazy leaf does, and a parent that only groups children has no
 * semantic title of its own.
 *
 * The list became an INDEX child here so the detail can sit beside it. That is
 * also what makes the list's `rowHref={(item) => item.id}` resolve against
 * `/returns` (the `invoices` / `customers` shape); #2335 deliberately held the
 * prop back until this route existed, because a row that navigates to an
 * unregistered path clicks through to a blank page.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const returnsListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Returns' },
};

const returnDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Return' },
};

export const returnsRoute: RouteObject = {
  path: 'returns',
  children: [
    {
      index: true,
      handle: returnsListCrumb,
      lazy: async () => {
        const { ReturnsListPage } = await import('../../pages/returns/returns-list-page');
        return { Component: ReturnsListPage };
      },
    },
    {
      path: ':returnId',
      handle: returnDetailCrumb,
      lazy: async () => {
        const { ReturnDetailPage } = await import('../../pages/returns/return-detail-page');
        return { Component: ReturnDetailPage };
      },
    },
  ],
};
