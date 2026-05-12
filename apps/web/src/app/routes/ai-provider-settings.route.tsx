import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const aiProviderSettingsRoute: RouteObject = {
  path: 'ai/provider-settings',
  handle: { crumb: { group: 'AI', title: 'Provider settings' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AiProviderSettingsPage } = await import(
      '../../pages/ai-provider-settings/ai-provider-settings-page'
    );
    return { Component: AiProviderSettingsPage };
  },
};
