import type { RouteObject } from 'react-router-dom';
import { PromptTemplatesListPage } from '../../pages/prompt-templates/prompt-templates-list-page';

export const promptTemplatesListRoute: RouteObject = {
  path: 'settings/prompt-templates',
  element: <PromptTemplatesListPage />,
};
