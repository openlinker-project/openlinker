import type { RouteObject } from 'react-router-dom';
import { OrdersListPage } from '../../pages/orders/orders-list-page';
import { OrderDetailPage } from '../../pages/orders/order-detail-page';

export const ordersRoute: RouteObject = {
  path: 'orders',
  children: [
    { index: true, element: <OrdersListPage /> },
    { path: ':internalOrderId', element: <OrderDetailPage /> },
  ],
};
