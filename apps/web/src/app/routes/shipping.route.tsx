import type { RouteObject } from 'react-router-dom';
import { ModulePlaceholderPage } from '../../pages/placeholders/module-placeholder-page';

export const shippingRoute: RouteObject = {
  path: 'shipping',
  element: (
    <ModulePlaceholderPage
      eyebrow="Platform"
      title="Shipping workspace"
      moduleName="Shipping"
      description="Carrier connectivity, shipment exceptions, and fulfillment-side diagnostics will be anchored here in later work."
    />
  ),
};
