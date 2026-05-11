import type { RouteObject } from 'react-router-dom';

export const aiProviderSettingsRoute: RouteObject = {
  path: 'ai/provider-settings',
  lazy: async () => {
    const { AiProviderSettingsPage } = await import(
      '../../pages/ai-provider-settings/ai-provider-settings-page'
    );
    return { Component: AiProviderSettingsPage };
  },
};
