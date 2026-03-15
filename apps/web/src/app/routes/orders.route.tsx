import type { RouteObject } from 'react-router-dom';
import { ModulePlaceholderPage } from '../../pages/placeholders/module-placeholder-page';

export const ordersRoute: RouteObject = {
  path: 'orders',
  element: (
    <ModulePlaceholderPage
      eyebrow="Operations"
      title="Orders workspace"
      moduleName="Orders"
      description="Order intake, exceptions, and reconciliation will live here once the shell-level navigation contract is in place."
    />
  ),
};
