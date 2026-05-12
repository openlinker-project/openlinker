import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const customersListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Customers' },
};
const customerDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Customer' },
};

export const customersRoute: RouteObject = {
  path: 'customers',
  children: [
    {
      index: true,
      handle: customersListCrumb,
      lazy: async () => {
        const { CustomersListPage } = await import('../../pages/customers/customers-list-page');
        return { Component: CustomersListPage };
      },
    },
    {
      path: ':id',
      handle: customerDetailCrumb,
      lazy: async () => {
        const { CustomerDetailPage } = await import('../../pages/customers/customer-detail-page');
        return { Component: CustomerDetailPage };
      },
    },
  ],
};
