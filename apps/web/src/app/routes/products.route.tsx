import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const productsListCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'products' },
};
const costPricesCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'costPrices' },
};
const bundleNewCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'bundleNew' },
};
const bundleEditCrumb: RouteCrumbHandle = {
  crumb: { group: 'operations', page: 'bundleEdit' },
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
      path: 'bundles/new',
      handle: bundleNewCrumb,
      lazy: async () => {
        const { BundleFormPage } = await import('../../pages/products/bundle-form-page');
        return { Component: BundleFormPage };
      },
    },
    {
      path: 'bundles/:variantId',
      handle: bundleEditCrumb,
      lazy: async () => {
        const { BundleFormPage } = await import('../../pages/products/bundle-form-page');
        return { Component: BundleFormPage };
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
