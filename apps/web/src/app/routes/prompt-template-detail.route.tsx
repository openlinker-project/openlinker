import type { RouteObject } from 'react-router-dom';

export const promptTemplateDetailRoute: RouteObject = {
  path: 'ai/prompt-templates/:id',
  lazy: async () => {
    const { PromptTemplateDetailPage } = await import(
      '../../pages/prompt-templates/prompt-template-detail-page'
    );
    return { Component: PromptTemplateDetailPage };
  },
};
