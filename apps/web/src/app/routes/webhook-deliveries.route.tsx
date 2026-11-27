import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const webhooksListCrumb: RouteCrumbHandle = {
  crumb: { group: 'diagnostics', page: 'webhooks' },
};
const webhookDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'diagnostics', page: 'webhook' },
};

export const webhookDeliveriesRoute: RouteObject = {
  path: 'webhook-deliveries',
  children: [
    {
      index: true,
      handle: webhooksListCrumb,
      lazy: async () => {
        const { WebhookDeliveriesPage } = await import(
          '../../pages/webhook-deliveries/webhook-deliveries-page'
        );
        return { Component: WebhookDeliveriesPage };
      },
    },
    {
      path: ':id',
      handle: webhookDetailCrumb,
      lazy: async () => {
        const { WebhookDeliveryDetailPage } = await import(
          '../../pages/webhook-deliveries/webhook-delivery-detail-page'
        );
        return { Component: WebhookDeliveryDetailPage };
      },
    },
  ],
};
