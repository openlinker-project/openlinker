import type { RouteObject } from 'react-router-dom';
import { ModulePlaceholderPage } from '../../pages/placeholders/module-placeholder-page';

export const productsRoute: RouteObject = {
  path: 'products',
  element: (
    <ModulePlaceholderPage
      eyebrow="Operations"
      title="Products workspace"
      moduleName="Products"
      description="Product catalog controls, mapping review, and publishing diagnostics will be added here in later frontend slices."
    />
  ),
};
