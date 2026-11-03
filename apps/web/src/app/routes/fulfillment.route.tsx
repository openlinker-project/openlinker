/**
 * The fulfilment screen (#3340, ADR-074; merged onto `/fulfillment`; detail
 * child added by #3098)
 *
 * `/fulfillment` (the merged screen, answering two questions about one read
 * through a grouping switch: who packs a task, and where it is packed from)
 * and `/fulfillment/works/:workId` (one task, #3096). Both are lazy page
 * chunks and both carry their own breadcrumb — the crumb-contract test
 * asserts every lazy leaf does, and a parent that only groups children has no
 * semantic title of its own, so this route DROPPED its own `handle` when the
 * screen became an INDEX child. That is the shape `returns.route.tsx`
 * already uses, copied rather than re-derived; `coreChildren` still spreads
 * this one object, so `root.route.tsx` needed no edit.
 *
 * The child path keeps the `works/` segment the API and the mockup both use
 * (`GET /fulfillment/works/:workId`), rather than collapsing to a bare
 * `:workId`. A bare param would make `/fulfillment/anything` a detail
 * address, so a future sibling page under this prefix (there was one,
 * `/fulfillment/assign`, until the merge below) could not be added without
 * shadowing.
 *
 * ## It used to be two screens
 *
 * `/fulfillment` was a worklist grouped by (location, delivery method) and
 * `/fulfillment/assign` a staffing board grouped by packer. Both called the
 * same `GET /fulfillment/works` and differed in nothing else, so the split
 * cost more than it bought: the board could put work on hold and had no way
 * to release it, because `release_hold` lived only on the worklist, while the
 * worklist had no roster, no assignment write and no drag. The axis is a
 * switch now (`?groupBy=`), and the worklist is gone.
 *
 * `/fulfillment/assign` stays as a redirect rather than a 404: the path has
 * been in the nav and in shared links, and breaking a bookmark to make a
 * point about topology is not worth it.
 *
 * It is TEMPORARY, and saying so is the point (#3415 review) - a redirect
 * with no stated expiry is how a route list grows. Nothing in the tree points
 * at the old path any more: the nav registry moved with the merge and the
 * user guide's own reference moved in the same pass, so the only thing this
 * route now serves is a bookmark or a link somebody pasted into a chat before
 * the merge. Remove it one minor release after this ships; there is no data
 * behind it and no migration to run, so the removal is a deleted export and a
 * `route-lazy.test.ts` count.
 *
 * @module app/routes
 */
import { Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const fulfillmentScreenCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Fulfilment' },
};

const fulfillmentWorkDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Fulfilment task' },
};

export const fulfillmentRoute: RouteObject = {
  path: 'fulfillment',
  children: [
    {
      index: true,
      handle: fulfillmentScreenCrumb,
      lazy: async () => {
        const { AssignPackingWorkPage } = await import(
          '../../pages/fulfillment/assign-packing-work-page'
        );
        return { Component: AssignPackingWorkPage };
      },
    },
    {
      path: 'works/:workId',
      handle: fulfillmentWorkDetailCrumb,
      lazy: async () => {
        const { FulfillmentWorkDetailPage } = await import(
          '../../pages/fulfillment/fulfillment-work-detail-page'
        );
        return { Component: FulfillmentWorkDetailPage };
      },
    },
  ],
};

/**
 * The old staffing-board path. TEMPORARY - see the module docblock for when
 * it goes and why it is safe to take it.
 *
 * Eager `element`, not `lazy` — matching `analyticsLegacyRedirectRoute`, and
 * the reason `route-lazy.test.ts`'s count drops by one rather than staying
 * put: a redirect loads nothing.
 */
export const assignPackingWorkLegacyRedirectRoute: RouteObject = {
  path: 'fulfillment/assign',
  element: <Navigate to="/fulfillment" replace />,
};
