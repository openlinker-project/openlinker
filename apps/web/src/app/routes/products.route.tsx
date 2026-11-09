import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const productsListCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'products' },
};
const costPricesCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'costPrices' },
};
const productDetailCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'product' },
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
      path: 'cost-prices',
      handle: costPricesCrumb,
      lazy: async () => {
        const { CostPricesPage } = await import('../../pages/products/cost-prices-page');
        return { Component: CostPricesPage };
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
