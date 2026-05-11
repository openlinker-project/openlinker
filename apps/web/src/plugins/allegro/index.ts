/**
 * Allegro plugin
 *
 * Contributes the Allegro typed API namespace (`apiClient.allegro`) and the
 * two Allegro-specific routes (OAuth callback + setup wizard). The actual
 * API factory and page components stay in `features/allegro/` and `pages/`
 * for this MVP — this file is the thin shim that wires them into the
 * registry.
 *
 * @module plugins/allegro
 */
import { createAllegroApi, type AllegroApi } from '../../features/allegro/api/allegro.api';
import { definePlugin } from '../define-plugin';
import { allegroCallbackRoute } from './allegro-callback.route';
import { allegroSetupRoute } from './allegro-setup.route';

declare module '../../app/api/api-client' {
  interface PluginApiNamespaces {
    allegro: AllegroApi;
  }
}

export const allegroPlugin = definePlugin({
  id: 'allegro',
  routes: [allegroCallbackRoute, allegroSetupRoute],
  apiNamespaces: (request) => ({ allegro: createAllegroApi(request) }),
});
