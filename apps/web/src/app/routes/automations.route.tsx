import type { RouteObject } from 'react-router-dom';
import { ModulePlaceholderPage } from '../../pages/placeholders/module-placeholder-page';

export const automationsRoute: RouteObject = {
  path: 'automations',
  element: (
    <ModulePlaceholderPage
      eyebrow="Operations"
      title="Automations workspace"
      moduleName="Automations"
      description="Future automation rules, triggers, and operator override controls will be introduced in this route."
    />
  ),
};
