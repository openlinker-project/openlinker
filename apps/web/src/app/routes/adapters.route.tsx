import type { RouteObject } from 'react-router-dom';
import { AdaptersCatalogPage } from '../../pages/adapters/adapters-catalog-page';

export const adaptersRoute: RouteObject = {
  path: 'adapters',
  element: <AdaptersCatalogPage />,
};
