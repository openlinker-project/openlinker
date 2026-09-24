/**
 * Assign Packing Work route (#3340, ADR-074)
 *
 * `/fulfillment/assign` — a sibling of `/fulfillment` under the same
 * "Operations" crumb group, kept as its own top-level path segment rather
 * than a nested child (matching the `settings/who-decides` flat-path
 * precedent — `coreChildren` is a flat array of `RouteObject`s, none nested).
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const assignPackingWorkRoute: RouteObject = {
  path: 'fulfillment/assign',
  handle: {
    crumb: { group: 'Operations', title: 'Assign packing work' },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AssignPackingWorkPage } = await import(
      '../../pages/fulfillment/assign-packing-work-page'
    );
    return { Component: AssignPackingWorkPage };
  },
};
