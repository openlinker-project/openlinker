import type { RouteObject } from 'react-router-dom';
import { PromptTemplatesListPage } from '../../pages/prompt-templates/prompt-templates-list-page';

export const promptTemplatesListRoute: RouteObject = {
  path: 'ai/prompt-templates',
  element: <PromptTemplatesListPage />,
};
