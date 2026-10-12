/**
 * Shoper plugin
 *
 * Front for the Shoper connection (#3639): the guided setup route, the
 * setup card, and the order defaults (delivery / payment / status) edit
 * section (#3702). No other contributions yet. The section reads
 * `enabledCapabilities` only to explain why its lists are unavailable.
 *
 * @module plugins/shoper
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { ShoperOrderDefaultsSection } from './components/shoper-order-defaults-section';
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
    StructuredConfigSection: ShoperOrderDefaultsSection,
    connectionConfig: shoperConnectionConfig,
  },
});
