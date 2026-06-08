/**
 * WooCommerce plugin
 *
 * Unified contribution (#702) — WooCommerce contributes both the setup
 * route (build-time) and platform-side affordances (setup card, structured
 * config inputs, credentials panel).
 *
 * @module plugins/woocommerce
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { WoocommerceCredentialsPanel } from './components/woocommerce-credentials-panel';
import { WoocommerceStructuredSection } from './components/woocommerce-structured-section';
import { woocommerceSetupRoute } from './woocommerce-setup.route';

export const woocommercePlugin: OpenLinkerPlugin = definePlugin({
  id: 'woocommerce',
  platformType: 'woocommerce',
  build: {
    routes: [woocommerceSetupRoute],
  },
  platform: {
    displayName: 'WooCommerce',
    setupCard: {
      title: 'WooCommerce',
      description:
        'Connect a WooCommerce store via the REST API. You will need the site URL and a Consumer Key / Secret pair.',
      to: '/connections/new/woocommerce',
      badge: 'REST API',
    },
    StructuredConfigSection: WoocommerceStructuredSection,
    CredentialsPanel: WoocommerceCredentialsPanel,
  },
});
