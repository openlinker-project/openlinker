/**
 * Release Center Settings Route
 *
 * Lazy route module for the admin news and notifications page at `settings/release-center`.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const releaseCenterSettingsRoute: RouteObject = {
  path: 'settings/release-center',
  handle: { crumb: { group: 'settings', page: 'releaseCenter' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ReleaseCenterSettingsPage } = await import('../../pages/settings/release-center-settings-page');
    return { Component: ReleaseCenterSettingsPage };
  },
};
