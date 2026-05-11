/**
 * PrestaShop Platform Plugin
 *
 * In-tree plugin definition for the PrestaShop platform. Contributes:
 *
 *   - Setup card on `PlatformPicker`
 *   - Structured-config inputs in `EditConnectionForm` (Shop URL, etc.)
 *   - "Configure webhooks" action in `ConnectionActionsPanel`
 *   - Default for the OL callback URL field (`window.location.origin`)
 *   - Rotate-webservice-key panel in `EditConnectionForm.CredentialsPanel`
 *
 * @module plugins/prestashop
 */
import type { PlatformPlugin } from '../../shared/plugins';
import { PrestashopStructuredSection } from './components/prestashop-structured-section';
import { PrestashopConnectionActions } from './components/prestashop-connection-actions';
import { PrestashopCredentialsPanel } from './components/prestashop-credentials-panel';

export const prestashopPlugin: PlatformPlugin = {
  platformType: 'prestashop',
  displayName: 'PrestaShop',
  setupCard: {
    title: 'PrestaShop',
    description:
      'Connect a PrestaShop store via the Webservice API. You will need the shop URL and a webservice key.',
    to: '/connections/new/prestashop',
    badge: 'Webservice API',
  },
  getCallbackUrlDefault: () =>
    typeof window !== 'undefined' ? window.location.origin : undefined,
  StructuredConfigSection: PrestashopStructuredSection,
  CredentialsPanel: PrestashopCredentialsPanel,
  ConnectionActions: PrestashopConnectionActions,
};
