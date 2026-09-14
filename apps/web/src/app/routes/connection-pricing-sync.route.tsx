import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

/**
 * Connection Pricing & Sync route (#3149/#3166 review, ADR-072)
 *
 * `PricingAndSyncSection` used to be mounted inline inside
 * `EditConnectionForm`'s shared mega-form. Two independent writers of
 * `Connection.config.pricingRule` on ONE page (the legacy flat
 * `StockAndPricingSection` and this section's nested `{default,
 * sourceOverrides}` shape) produced a stale-merge-on-submit hazard and a
 * destructive-checkbox hazard — see `EditConnectionForm.tsx`'s own comment
 * at the (now-removed) mount site. Moving this to its own route removes the
 * possibility of the two editors interacting on one form submit, mirroring
 * the `SalesDocumentStatusSection` precedent: one editable surface, linked
 * to from elsewhere, never duplicated inline in a form that also
 * independently writes the same config key.
 */
export const connectionPricingSyncRoute: RouteObject = {
  path: 'connections/:connectionId/pricing-sync',
  handle: { crumb: { group: 'Platform', title: 'Connection' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ConnectionPricingSyncPage } = await import(
      '../../pages/connections/connection-pricing-sync-page'
    );
    return { Component: ConnectionPricingSyncPage };
  },
};
