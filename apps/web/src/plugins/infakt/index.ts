/**
 * inFakt plugin
 *
 * Unified contribution (#1282, epic #1279) for inFakt — a Polish accounting
 * SaaS that submits invoices to KSeF on OpenLinker's behalf and reports back
 * clearance status. inFakt carries the neutral `Invoicing` capability
 * (ADR-026, backend #1292/#1293); this plugin contributes:
 *
 *   - the guided setup route (build-time) + setup card (platform-side)
 *   - the structured-config edit section (sandbox baseUrl override)
 *   - the write-only credentials panel (single API key rotation)
 *   - the per-provider invoice detail section (KSeF number + clearance status)
 *   - the per-provider invoice correction flow (KOR)
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
import { InfaktCredentialsPanel } from './components/infakt-credentials-panel';
import { InfaktInvoiceCorrectionFlow } from './components/infakt-invoice-correction-flow';
import { InfaktInvoiceDetailSection } from './components/infakt-invoice-detail-section';
import { InfaktStructuredSection } from './components/infakt-structured-section';
import { infaktSetupRoute } from './infakt-setup.route';

export const infaktPlugin: OpenLinkerPlugin = definePlugin({
  id: 'infakt',
  platformType: 'infakt',
  build: {
    routes: [infaktSetupRoute],
  },
  platform: {
    displayName: 'inFakt',
    setupCard: {
      title: 'inFakt',
      description: 'Polish accounting platform with native KSeF integration',
      to: '/connections/new/infakt',
      badge: 'API key',
    },
    StructuredConfigSection: InfaktStructuredSection,
    CredentialsPanel: InfaktCredentialsPanel,
    invoiceDetailSection: InfaktInvoiceDetailSection,
    invoiceCorrectionFlow: InfaktInvoiceCorrectionFlow,
  },
});
