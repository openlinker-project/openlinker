import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const promptTemplatesListRoute: RouteObject = {
  path: 'ai/prompt-templates',
  handle: { crumb: { group: 'AI', title: 'Prompt templates' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { PromptTemplatesListPage } = await import(
      '../../pages/prompt-templates/prompt-templates-list-page'
    );
    return { Component: PromptTemplatesListPage };
  },
};
