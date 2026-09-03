/**
 * Fulfilment route (#2410)
 *
 * `/fulfillment` — the standalone operator worklist. A single lazy leaf with
 * its own crumb; the crumb-contract test asserts every lazy leaf carries one.
 *
 * The path keeps the American spelling every other identifier in this slice
 * uses (the folder, the feature, the API), while the operator-facing TITLE is
 * the British "Fulfilment" the epic's naming rule requires — the URL is not
 * copy, and making the two agree would mean changing one of them for the wrong
 * reason.
 *
 * @module app/routes
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const fulfillmentCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Fulfilment' },
};

export const fulfillmentRoute: RouteObject = {
  path: 'fulfillment',
  handle: fulfillmentCrumb,
  lazy: async () => {
    const { FulfillmentWorklistPage } = await import(
      '../../pages/fulfillment/fulfillment-worklist-page'
    );
    return { Component: FulfillmentWorklistPage };
  },
};
