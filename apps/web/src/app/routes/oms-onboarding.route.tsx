/**
 * Route: `/settings/packing` — "Pack orders in OpenLinker" (#3457)
 *
 * The OMS onboarding wizard and, once packing is on, its status page. Lazy:
 * nothing else in the entry bundle needs `features/oms-onboarding`.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const omsOnboardingRoute: RouteObject = {
  path: 'settings/packing',
  handle: { crumb: { group: 'Settings', title: 'Pack orders in OpenLinker' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { OmsOnboardingPage } = await import('../../pages/oms/oms-onboarding-page');
    return { Component: OmsOnboardingPage };
  },
};
