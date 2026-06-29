/**
 * InPost plugin (FE)
 *
 * Carrier (shipping-only) FE plugin. Contributes the guided setup route
 * (build-time) plus the platform-side connection-settings surface (#771):
 * a setup card, structured-config editing (environment, organization id,
 * sender address), and a credentials panel for the ShipX API token. The
 * webhook runbook `ConnectionActions` (#768) is retained.
 *
 * InPost declares one capability (`ShippingProviderManager`), so it contributes
 * none of the marketplace slots.
 *
 * @module plugins/inpost
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { InpostCredentialsPanel } from './components/inpost-credentials-panel';
import { InpostStructuredSection } from './components/inpost-structured-section';
import { InpostWebhookRunbook } from './components/inpost-webhook-runbook';
import { inpostSetupRoute } from './inpost-setup.route';

export const inpostPlugin: OpenLinkerPlugin = definePlugin({
  id: 'inpost',
  platformType: 'inpost',
  build: {
    routes: [inpostSetupRoute],
  },
  platform: {
    displayName: 'InPost',
    setupCard: {
      title: 'InPost',
      description:
        'Connect an InPost ShipX courier account. You will need a ShipX API token and your organization id.',
      to: '/connections/new/inpost',
      badge: 'ShipX API',
    },
    StructuredConfigSection: InpostStructuredSection,
    CredentialsPanel: InpostCredentialsPanel,
    ConnectionActions: InpostWebhookRunbook,
  },
});
