import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const productsListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Products' },
};
const productDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'Operations', title: 'Product' },
};

export const productsRoute: RouteObject = {
  path: 'products',
  children: [
    {
      index: true,
      handle: productsListCrumb,
      lazy: async () => {
        const { ProductsListPage } = await import('../../pages/products/products-list-page');
        return { Component: ProductsListPage };
      },
    },
    {
      path: ':id',
      handle: productDetailCrumb,
      lazy: async () => {
        const { ProductDetailPage } = await import('../../pages/products/product-detail-page');
        return { Component: ProductDetailPage };
      },
    },
  ],
};
