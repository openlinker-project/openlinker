/**
 * Shoper plugin
 *
 * Front for the Shoper connection (#3639): the guided setup route and the
 * setup card. No capability-driven contributions yet (edit sections,
 * credentials panel, ...): the connection's capabilities come from the backend
 * manifest and are not branched on in the browser.
 *
 * @module plugins/shoper
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
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
  },
});
