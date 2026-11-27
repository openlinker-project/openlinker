/**
 * WooCommerce plugin
 *
 * Unified contribution (#702) — WooCommerce contributes both the setup
 * route (build-time) and platform-side affordances (setup card, structured
 * config inputs, credentials panel).
 *
 * @module plugins/woocommerce
 */
import { WoocommercePublishWizard } from '../../features/listings';
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { getWoocommerceMessages, woocommerceMessages } from './messages';
import { WoocommerceCredentialsPanel } from './components/woocommerce-credentials-panel';
import { WoocommerceStructuredSection } from './components/woocommerce-structured-section';
import { woocommerceSetupRoute } from './woocommerce-setup.route';

export const woocommercePlugin: OpenLinkerPlugin = definePlugin({
  id: 'woocommerce',
  messages: woocommerceMessages,
  platformType: 'woocommerce',
  build: {
    routes: [woocommerceSetupRoute],
    // Capability-shaped shop publishing (#1044): the listings page resolves
    // this contribution via `useShopPublishWizard('woocommerce')` and renders
    // the wizard inside the launcher's Dialog.
    shopProductPublishWizard: {
      platformType: 'woocommerce',
      component: WoocommercePublishWizard,
    },
  },
  platform: {
    displayName: 'WooCommerce',
    // Getters, not values: the card is read at render, so the copy follows
    // the active language instead of freezing at module load.
    setupCard: {
      title: 'WooCommerce',
      get description(): string {
        return getWoocommerceMessages().plugin.setupCard.description;
      },
      to: '/connections/new/woocommerce',
      get badge(): string {
        return getWoocommerceMessages().plugin.setupCard.badge;
      },
    },
    StructuredConfigSection: WoocommerceStructuredSection,
    CredentialsPanel: WoocommerceCredentialsPanel,
  },
});
