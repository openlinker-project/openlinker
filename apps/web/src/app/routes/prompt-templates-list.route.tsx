import type { RouteObject } from 'react-router-dom';

export const promptTemplatesListRoute: RouteObject = {
  path: 'ai/prompt-templates',
  lazy: async () => {
    const { PromptTemplatesListPage } = await import(
      '../../pages/prompt-templates/prompt-templates-list-page'
    );
    return { Component: PromptTemplatesListPage };
  },
};
