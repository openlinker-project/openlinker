/**
 * Route: `/settings/login-page` (#4029) - the admin's login page editor.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const loginPageSettingsRoute: RouteObject = {
  path: 'settings/login-page',
  handle: { crumb: { group: 'Platform', title: 'Login page' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { LoginPageSettingsPage } = await import('../../pages/settings/login-page-settings-page');
    return { Component: LoginPageSettingsPage };
  },
};
