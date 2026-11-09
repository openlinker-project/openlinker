import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

/**
 * Gift cost report (#3943). A sub-page of Analytics, reached from its header.
 */
export const giftReportRoute: RouteObject = {
  path: 'analytics/gifts',
  handle: { crumb: { group: 'operations', page: 'giftCost' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { GiftReportPage } = await import('../../pages/analytics/gift-report-page');
    return { Component: GiftReportPage };
  },
};
