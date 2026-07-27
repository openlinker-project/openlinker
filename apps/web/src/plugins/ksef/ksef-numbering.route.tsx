/**
 * Route: `/connections/:connectionId/numbering` — KSeF invoice numbering page.
 *
 * Contributed by the KSeF plugin (build slot). The breadcrumb is declared via
 * `handle.crumb`, matching the sibling `ksef-setup.route`.
 *
 * @module plugins/ksef
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const ksefNumberingRoute: RouteObject = {
  path: 'connections/:connectionId/numbering',
  handle: { crumb: { group: 'Platform', title: 'Invoice numbering' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { KsefNumberingPage } = await import('./components/ksef-numbering-page');
    return { Component: KsefNumberingPage };
  },
};
