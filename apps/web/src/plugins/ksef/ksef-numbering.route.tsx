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
import { getKsefMessages } from './messages';

export const ksefNumberingRoute: RouteObject = {
  path: 'connections/:connectionId/numbering',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getKsefMessages().ksefNumberingPage.title;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { KsefNumberingPage } = await import('./components/ksef-numbering-page');
    return { Component: KsefNumberingPage };
  },
};
