/**
 * KSeF plugin
 *
 * Unified contribution (#702 / #1152, epic #1142 C8) for KSeF — the Polish
 * national e-invoicing system (Krajowy System e-Faktur). KSeF carries the
 * neutral `Invoicing` capability (ADR-026); this plugin contributes:
 *
 *   - the guided setup route (build-time) + setup card (platform-side)
 *   - the structured-config edit section (environment / seller context)
 *   - the write-only credentials panel (auth type + secret rotation)
 *   - the per-provider invoice detail section (KSeF number + clearance status)
 *
 * Per ADR-026, the FE never reasons about Polish specifics through
 * `platformType === 'ksef'` string-matching in shared components — every
 * platform-specific affordance is resolved through the registry via
 * `usePlatform('ksef')`. The invoice surfacing on the order-detail page is
 * neutral-field-gated (presence of `regulatoryStatus` / `clearanceReference`),
 * not gated on this platform type — the neutral panel invokes the
 * `invoiceDetailSection` slot without inspecting `platformType`.
 *
 * @module plugins/ksef
 */
import { createNumberingApi, type NumberingApi } from '../../features/invoicing';
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { KsefConnectionActions } from './components/ksef-connection-actions';
import { KsefCredentialsPanel } from './components/ksef-credentials-panel';
import { KsefInvoiceCorrectionFlow } from './components/ksef-invoice-correction-flow';
import { KsefInvoiceDetailSection } from './components/ksef-invoice-detail-section';
import { KsefStructuredSection } from './components/ksef-structured-section';
import { ksefConnectionConfig } from './ksef-connection-config';
import { ksefNumberingRoute } from './ksef-numbering.route';
import { ksefSetupRoute } from './ksef-setup.route';

// Invoice numbering (#1577) is core-invoicing, but numbering is only reachable
// today from a KSeF connection's Actions — so the typed namespace rides the
// KSeF plugin's build slot (declaration-merged), mirroring the Allegro pattern.
declare module '../../app/api/api-client' {
  interface PluginApiNamespaces {
    invoiceNumbering: NumberingApi;
  }
}

export const ksefPlugin: OpenLinkerPlugin = definePlugin({
  id: 'ksef',
  platformType: 'ksef',
  build: {
    routes: [ksefSetupRoute, ksefNumberingRoute],
    apiNamespaces: (request) => ({ invoiceNumbering: createNumberingApi(request) }),
  },
  platform: {
    displayName: 'KSeF (e-invoicing)',
    setupCard: {
      title: 'KSeF',
      description:
        'Connect the Polish national e-invoicing system (Krajowy System e-Faktur) to clear invoices. You will need a KSeF authorization token or a qualified electronic seal.',
      to: '/connections/new/ksef',
      badge: 'e-Invoicing',
    },
    StructuredConfigSection: KsefStructuredSection,
    connectionConfig: ksefConnectionConfig,
    CredentialsPanel: KsefCredentialsPanel,
    ConnectionActions: KsefConnectionActions,
    invoiceDetailSection: KsefInvoiceDetailSection,
    invoiceCorrectionFlow: KsefInvoiceCorrectionFlow,
  },
});
