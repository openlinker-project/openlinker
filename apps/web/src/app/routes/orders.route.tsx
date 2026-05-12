import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const ordersListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Orders' },
};
const failedOrdersCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Failed orders' },
};
const orderDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Order' },
};

export const ordersRoute: RouteObject = {
  path: 'orders',
  children: [
    {
      index: true,
      handle: ordersListCrumb,
      lazy: async () => {
        const { OrdersListPage } = await import('../../pages/orders/orders-list-page');
        return { Component: OrdersListPage };
      },
    },
    {
      path: 'failed',
      handle: failedOrdersCrumb,
      lazy: async () => {
        const { FailedOrdersPage } = await import('../../pages/orders/failed-orders-page');
        return { Component: FailedOrdersPage };
      },
    },
    {
      path: ':internalOrderId',
      handle: orderDetailCrumb,
      lazy: async () => {
        const { OrderDetailPage } = await import('../../pages/orders/order-detail-page');
        return { Component: OrderDetailPage };
      },
    },
  ],
};
