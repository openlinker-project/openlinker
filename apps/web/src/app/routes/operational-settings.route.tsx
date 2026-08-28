import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const operationalSettingsRoute: RouteObject = {
  path: 'settings/sync-pacing',
  handle: { crumb: { group: 'Settings', title: 'Sync pacing' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { OperationalSettingsPage } = await import(
      '../../pages/settings/operational-settings-page'
    );
    return { Component: OperationalSettingsPage };
  },
};
