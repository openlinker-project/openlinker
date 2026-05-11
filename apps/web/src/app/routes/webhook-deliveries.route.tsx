import type { RouteObject } from 'react-router-dom';

export const webhookDeliveriesRoute: RouteObject = {
  path: 'webhook-deliveries',
  children: [
    {
      index: true,
      lazy: async () => {
        const { WebhookDeliveriesPage } = await import(
          '../../pages/webhook-deliveries/webhook-deliveries-page'
        );
        return { Component: WebhookDeliveriesPage };
      },
    },
    {
      path: ':id',
      lazy: async () => {
        const { WebhookDeliveryDetailPage } = await import(
          '../../pages/webhook-deliveries/webhook-delivery-detail-page'
        );
        return { Component: WebhookDeliveryDetailPage };
      },
    },
  ],
};
