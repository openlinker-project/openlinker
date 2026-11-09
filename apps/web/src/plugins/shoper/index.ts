/**
 * Shoper plugin
 *
 * Front for the Shoper connection (#3639): the guided setup route, the setup
 * card, the edit-connection section (webhook callback URL (#3644) and order
 * defaults: delivery / payment / status (#3702)) and the Configure webhooks
 * action (#3644). The components read `enabledCapabilities` only to explain
 * why a control is unavailable.
 *
 * @module plugins/shoper
 */
import { publicApiBaseUrl } from '../../shared/config/public-api-base-url';
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { getShoperMessages, shoperMessages } from './messages';
import { ShoperConnectionActions } from './components/shoper-connection-actions';
import { ShoperStructuredSection } from './components/shoper-structured-section';
import { shoperConnectionConfig } from './shoper-connection-config';
import { shoperSetupRoute } from './shoper-setup.route';

export const shoperPlugin: OpenLinkerPlugin = definePlugin({
  id: 'shoper',
  messages: shoperMessages,
  platformType: 'shoper',
  build: {
    routes: [shoperSetupRoute],
  },
  platform: {
    displayName: 'Shoper',
    setupCard: {
      title: 'Shoper',
      // Getters, not values: the card is read at render, so the copy follows
      // the active language instead of freezing at module load.
      get description(): string {
        return getShoperMessages().plugin.setupCard.description;
      },
      to: '/connections/new/shoper',
      get badge(): string {
        return getShoperMessages().plugin.setupCard.badge;
      },
    },
    getCallbackUrlDefault: publicApiBaseUrl,
    StructuredConfigSection: ShoperStructuredSection,
    connectionConfig: shoperConnectionConfig,
    ConnectionActions: ShoperConnectionActions,
  },
});
