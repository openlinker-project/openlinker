import type { RouteObject } from 'react-router-dom';
import { ModulePlaceholderPage } from '../../pages/placeholders/module-placeholder-page';

export const invoicesRoute: RouteObject = {
  path: 'invoices',
  element: (
    <ModulePlaceholderPage
      eyebrow="Platform"
      title="Invoices workspace"
      moduleName="Invoices"
      description="Invoice exports, document delivery, and accounting-facing exception handling will be added to this route later."
    />
  ),
};
