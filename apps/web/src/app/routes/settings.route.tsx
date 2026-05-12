import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const settingsRoute: RouteObject = {
  path: 'settings',
  handle: { crumb: { group: 'Platform', title: 'Settings' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SettingsPage } = await import('../../pages/settings/settings-page');
    return { Component: SettingsPage };
  },
};
