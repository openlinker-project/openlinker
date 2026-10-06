import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const orderTagsSettingsRoute: RouteObject = {
  path: 'settings/order-tags',
  handle: { crumb: { group: 'Platform', title: 'Order tags' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { OrderTagsSettingsPage } = await import('../../pages/settings/order-tags-settings-page');
    return { Component: OrderTagsSettingsPage };
  },
};
