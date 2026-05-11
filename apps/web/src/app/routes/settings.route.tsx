import type { RouteObject } from 'react-router-dom';

export const settingsRoute: RouteObject = {
  path: 'settings',
  lazy: async () => {
    const { SettingsPage } = await import('../../pages/settings/settings-page');
    return { Component: SettingsPage };
  },
};
