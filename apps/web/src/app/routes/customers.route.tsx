import type { RouteObject } from 'react-router-dom';

export const customersRoute: RouteObject = {
  path: 'customers',
  children: [
    {
      index: true,
      lazy: async () => {
        const { CustomersListPage } = await import('../../pages/customers/customers-list-page');
        return { Component: CustomersListPage };
      },
    },
    {
      path: ':id',
      lazy: async () => {
        const { CustomerDetailPage } = await import('../../pages/customers/customer-detail-page');
        return { Component: CustomerDetailPage };
      },
    },
  ],
};
