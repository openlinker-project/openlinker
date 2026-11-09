import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const ordersListCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'orders' },
};
const failedOrdersCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'failedOrders' },
};
const dispatchRiskCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'dispatchRisk' },
};
const orderDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'order' },
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
      // Must stay AHEAD of the `:internalOrderId` param route below, or it is
      // swallowed as an order id.
      path: 'dispatch-risk',
      handle: dispatchRiskCrumb,
      lazy: async () => {
        const { DispatchRiskPage } = await import('../../pages/orders/dispatch-risk-page');
        return { Component: DispatchRiskPage };
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
