/**
 * PrestaShop plugin
 *
 * Contributes the PrestaShop setup-wizard route. Routes-only plugin — no
 * API namespace yet (PrestaShop access goes through generic core APIs like
 * `connections`, not a dedicated `prestashop.*` surface).
 *
 * @module plugins/prestashop
 */
import { definePlugin } from '../define-plugin';
import { prestashopSetupRoute } from './prestashop-setup.route';

export const prestashopPlugin = definePlugin({
  id: 'prestashop',
  routes: [prestashopSetupRoute],
});
