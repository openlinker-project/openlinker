/**
 * inFakt plugin
 *
 * Unified contribution (#1282, epic #1279) for inFakt — a Polish accounting
 * SaaS that submits invoices to KSeF on OpenLinker's behalf and reports back
 * clearance status. inFakt carries the neutral `Invoicing` capability
 * (ADR-026, backend #1292/#1293); this plugin contributes:
 *
 *   - the guided setup route (build-time) + setup card (platform-side)
 *   - the structured-config edit section (sandbox/production environment select, #2174)
 *   - the write-only credentials panel (single API key rotation)
 *   - the per-provider invoice detail section (KSeF number + clearance status)
 *   - the per-provider invoice correction flow (KOR)
 *   - the connection-actions webhook-config modal (endpoint + optional signing
 *     secret paste, #1770)
 *
 * Per ADR-026, the FE never reasons about inFakt specifics through
 * `platformType === 'infakt'` string-matching in shared components — every
 * platform-specific affordance is resolved through the registry via
 * `usePlatform('infakt')`.
 *
 * @module plugins/infakt
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { getInfaktMessages, infaktMessages } from './messages';
import { InfaktCredentialsPanel } from './components/infakt-credentials-panel';
import { InfaktInvoiceCorrectionFlow } from './components/infakt-invoice-correction-flow';
import { InfaktInvoiceDetailSection } from './components/infakt-invoice-detail-section';
import { InfaktStructuredSection } from './components/infakt-structured-section';
import { InfaktWebhookConnectionActions } from './components/infakt-webhook-connection-actions';
import { infaktSetupRoute } from './infakt-setup.route';

export const infaktPlugin: OpenLinkerPlugin = definePlugin({
  id: 'infakt',
  messages: infaktMessages,
  platformType: 'infakt',
  build: {
    routes: [infaktSetupRoute],
  },
  platform: {
    displayName: 'inFakt',
    // Getters, not values: the card is read at render, so the copy follows
    // the active language instead of freezing at module load.
    setupCard: {
      title: 'inFakt',
      get description(): string {
        return getInfaktMessages().plugin.setupCard.description;
      },
      to: '/connections/new/infakt',
      get badge(): string {
        return getInfaktMessages().plugin.setupCard.badge;
      },
    },
    StructuredConfigSection: InfaktStructuredSection,
    CredentialsPanel: InfaktCredentialsPanel,
    ConnectionActions: InfaktWebhookConnectionActions,
    invoiceDetailSection: InfaktInvoiceDetailSection,
    invoiceCorrectionFlow: InfaktInvoiceCorrectionFlow,
  },
});
