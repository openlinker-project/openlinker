import type { RouteObject } from 'react-router-dom';
import { AiProviderSettingsPage } from '../../pages/ai-provider-settings/ai-provider-settings-page';

export const aiProviderSettingsRoute: RouteObject = {
  path: 'ai/provider-settings',
  element: <AiProviderSettingsPage />,
};
