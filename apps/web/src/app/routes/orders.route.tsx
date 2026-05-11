import type { RouteObject } from 'react-router-dom';

export const ordersRoute: RouteObject = {
  path: 'orders',
  children: [
    {
      index: true,
      lazy: async () => {
        const { OrdersListPage } = await import('../../pages/orders/orders-list-page');
        return { Component: OrdersListPage };
      },
    },
    {
      path: 'failed',
      lazy: async () => {
        const { FailedOrdersPage } = await import('../../pages/orders/failed-orders-page');
        return { Component: FailedOrdersPage };
      },
    },
    {
      path: ':internalOrderId',
      lazy: async () => {
        const { OrderDetailPage } = await import('../../pages/orders/order-detail-page');
        return { Component: OrderDetailPage };
      },
    },
  ],
};
