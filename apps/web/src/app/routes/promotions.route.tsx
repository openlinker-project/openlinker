/**
 * Promotions route (#3935)
 *
 * `/promotions` (the list in check order), `/promotions/new` (benefit type and
 * templates, then the form) and `/promotions/:promotionId` (one promotion).
 * `new` is declared before the dynamic segment, though React Router ranks static
 * segments above dynamic ones regardless; the order is kept explicit so a future
 * rename of the static path cannot start resolving as an id.
 *
 * `/automations/gifts*` redirect here: gift rules used to live under
 * Automations, and links to them (bookmarks, the old notices on an order) must
 * keep working.
 *
 * @module app/routes
 */
import type { ReactElement } from 'react';
import { Navigate, useParams, type RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const listCrumb: RouteCrumbHandle = { crumb: { group: 'operations', page: 'promotions' } };
const newCrumb: RouteCrumbHandle = { crumb: { group: 'operations', page: 'promotionNew' } };
const detailCrumb: RouteCrumbHandle = { crumb: { group: 'operations', page: 'promotion' } };

function GiftRuleRedirect(): ReactElement {
  const { ruleId = '' } = useParams();
  return <Navigate to={`/promotions/${encodeURIComponent(ruleId)}`} replace />;
}

export const promotionsRoute: RouteObject = {
  path: 'promotions',
  children: [
    {
      index: true,
      handle: listCrumb,
      lazy: async () => {
        const { PromotionsListPage } = await import('../../pages/promotions/promotions-list-page');
        return { Component: PromotionsListPage };
      },
    },
    {
      path: 'new',
      handle: newCrumb,
      lazy: async () => {
        const { PromotionPage } = await import('../../pages/promotions/promotion-page');
        return { Component: PromotionPage };
      },
    },
    {
      path: ':promotionId',
      handle: detailCrumb,
      lazy: async () => {
        const { PromotionPage } = await import('../../pages/promotions/promotion-page');
        return { Component: PromotionPage };
      },
    },
  ],
};

/** `/automations/gifts` and `/automations/gifts/:ruleId`, kept alive as redirects. */
export const giftRulesLegacyRedirects: RouteObject[] = [
  { path: 'gifts', element: <Navigate to="/promotions" replace /> },
  { path: 'gifts/new', element: <Navigate to="/promotions/new" replace /> },
  { path: 'gifts/:ruleId', element: <GiftRuleRedirect /> },
];
