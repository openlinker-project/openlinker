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
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { ShoperConnectionActions } from './components/shoper-connection-actions';
import { ShoperStructuredSection } from './components/shoper-structured-section';
import { shoperConnectionConfig } from './shoper-connection-config';
import { shoperSetupRoute } from './shoper-setup.route';

export const shoperPlugin: OpenLinkerPlugin = definePlugin({
  id: 'shoper',
  platformType: 'shoper',
  build: {
    routes: [shoperSetupRoute],
  },
  platform: {
    displayName: 'Shoper',
    setupCard: {
      title: 'Shoper',
      description: 'Connect your Shoper shop with its API token.',
      to: '/connections/new/shoper',
      badge: 'API token',
    },
    getCallbackUrlDefault: () =>
      typeof window !== 'undefined' ? window.location.origin : undefined,
    StructuredConfigSection: ShoperStructuredSection,
    connectionConfig: shoperConnectionConfig,
    ConnectionActions: ShoperConnectionActions,
  },
});
