import type { RouteObject } from 'react-router-dom';
import { ModulePlaceholderPage } from '../../pages/placeholders/module-placeholder-page';

export const inventoryRoute: RouteObject = {
  path: 'inventory',
  element: (
    <ModulePlaceholderPage
      eyebrow="Operations"
      title="Inventory workspace"
      moduleName="Inventory"
      description="Inventory health, conflict resolution, and stock synchronization workflows will expand into this area later."
    />
  ),
};
