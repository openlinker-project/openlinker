import type { RouteObject } from 'react-router-dom';
import { PromptTemplateDetailPage } from '../../pages/prompt-templates/prompt-template-detail-page';

export const promptTemplateDetailRoute: RouteObject = {
  path: 'settings/prompt-templates/:id',
  element: <PromptTemplateDetailPage />,
};
