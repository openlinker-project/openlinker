import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const promptTemplateDetailRoute: RouteObject = {
  path: 'ai/prompt-templates/:id',
  handle: { crumb: { group: 'AI', title: 'Prompt template' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { PromptTemplateDetailPage } = await import(
      '../../pages/prompt-templates/prompt-template-detail-page'
    );
    return { Component: PromptTemplateDetailPage };
  },
};
