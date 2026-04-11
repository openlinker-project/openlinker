import type { RouteObject } from 'react-router-dom';
import { CustomersListPage } from '../../pages/customers/customers-list-page';
import { CustomerDetailPage } from '../../pages/customers/customer-detail-page';

export const customersRoute: RouteObject = {
  path: 'customers',
  children: [
    { index: true, element: <CustomersListPage /> },
    { path: ':id', element: <CustomerDetailPage /> },
  ],
};
