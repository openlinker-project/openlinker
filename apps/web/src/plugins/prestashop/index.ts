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
import { publicApiBaseUrl } from '../../shared/config/public-api-base-url';
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { getPrestashopMessages, prestashopMessages } from './messages';
import { PrestashopConnectionActions } from './components/prestashop-connection-actions';
import { PrestashopCredentialsPanel } from './components/prestashop-credentials-panel';
import { PrestashopStructuredSection } from './components/prestashop-structured-section';
import { PrestashopExtraSection } from './components/prestashop-extra-section';
import { prestashopSetupRoute } from './prestashop-setup.route';

export const prestashopPlugin: OpenLinkerPlugin = definePlugin({
  id: 'prestashop',
  messages: prestashopMessages,
  platformType: 'prestashop',
  build: {
    routes: [prestashopSetupRoute],
  },
  platform: {
    displayName: 'PrestaShop',
    // Getters, not values: the card is read at render, so the copy follows
    // the active language instead of freezing at module load.
    setupCard: {
      title: 'PrestaShop',
      get description(): string {
        return getPrestashopMessages().plugin.setupCard.description;
      },
      to: '/connections/new/prestashop',
      get badge(): string {
        return getPrestashopMessages().plugin.setupCard.badge;
      },
    },
    getCallbackUrlDefault: publicApiBaseUrl,
    StructuredConfigSection: PrestashopStructuredSection,
    CredentialsPanel: PrestashopCredentialsPanel,
    ConnectionActions: PrestashopConnectionActions,
    ExtraConfigSection: PrestashopExtraSection,
  },
});
