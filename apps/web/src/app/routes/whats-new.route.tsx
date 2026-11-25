import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const whatsNewRoute: RouteObject = {
  path: 'whats-new',
  handle: { crumb: { group: 'settings', page: 'whatsNew' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { WhatsNewPage } = await import('../../pages/release-center/whats-new-page');
    return { Component: WhatsNewPage };
  },
};
