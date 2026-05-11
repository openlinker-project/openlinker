import type { RouteObject } from 'react-router-dom';

export const productsRoute: RouteObject = {
  path: 'products',
  children: [
    {
      index: true,
      lazy: async () => {
        const { ProductsListPage } = await import('../../pages/products/products-list-page');
        return { Component: ProductsListPage };
      },
    },
    {
      path: ':id',
      lazy: async () => {
        const { ProductDetailPage } = await import('../../pages/products/product-detail-page');
        return { Component: ProductDetailPage };
      },
    },
  ],
};
