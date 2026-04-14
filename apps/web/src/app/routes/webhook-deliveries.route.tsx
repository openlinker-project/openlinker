import type { RouteObject } from 'react-router-dom';
import { WebhookDeliveriesPage } from '../../pages/webhook-deliveries/webhook-deliveries-page';
import { WebhookDeliveryDetailPage } from '../../pages/webhook-deliveries/webhook-delivery-detail-page';

export const webhookDeliveriesRoute: RouteObject = {
  path: 'webhook-deliveries',
  children: [
    { index: true, element: <WebhookDeliveriesPage /> },
    { path: ':id', element: <WebhookDeliveryDetailPage /> },
  ],
};
