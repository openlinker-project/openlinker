import type { RouteObject } from 'react-router-dom';
import { ProductsListPage } from '../../pages/products/products-list-page';
import { ProductDetailPage } from '../../pages/products/product-detail-page';

export const productsRoute: RouteObject = {
  path: 'products',
  children: [
    { index: true, element: <ProductsListPage /> },
    { path: ':id', element: <ProductDetailPage /> },
  ],
};
