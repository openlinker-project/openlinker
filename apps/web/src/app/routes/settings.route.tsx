import type { RouteObject } from 'react-router-dom';
import { SettingsPage } from '../../pages/settings/settings-page';

export const settingsRoute: RouteObject = {
  path: 'settings',
  element: <SettingsPage />,
};
