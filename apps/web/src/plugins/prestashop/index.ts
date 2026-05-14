/**
 * PrestaShop plugin
 *
 * Unified contribution (#702) — PrestaShop contributes both the setup
 * route (build-time) and platform-side affordances (setup card, structured
 * config inputs, credentials panel, connection actions, callback-URL
 * default).
 *
 * @module plugins/prestashop
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { PrestashopConnectionActions } from './components/prestashop-connection-actions';
import { PrestashopCredentialsPanel } from './components/prestashop-credentials-panel';
import { PrestashopStructuredSection } from './components/prestashop-structured-section';
import { prestashopSetupRoute } from './prestashop-setup.route';

export const prestashopPlugin: OpenLinkerPlugin = definePlugin({
  id: 'prestashop',
  platformType: 'prestashop',
  build: {
    routes: [prestashopSetupRoute],
  },
  platform: {
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
  },
});
