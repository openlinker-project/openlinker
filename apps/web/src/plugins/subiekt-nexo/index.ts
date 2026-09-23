/**
 * Subiekt nexo plugin.
 *
 * Contributes the guided connection wizard and the connection-settings edit
 * surface for Subiekt nexo, reached through the OpenLinker Sfera bridge (BE
 * adapter `subiekt.nexo.v1`, platformType `subiekt-nexo`).
 *
 * SUBIEKT nexo AND SUBIEKT GT ARE TWO SEPARATE PRODUCTS and are never joined.
 * They are different InsERT products reached through different bridges with
 * different wire contracts, so they carry their own ids, their own
 * platformTypes and their own setup routes. nexo does invoicing only; GT
 * additionally serves the catalogue, stock, order ingestion and order
 * creation, which is why its manifest declares five capabilities and this one
 * declares `Invoicing` alone.
 *
 * @module plugins/subiekt-nexo
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { subiektNexoSetupRoute } from './subiekt-setup.route';
import { SubiektCredentialsPanel } from './components/subiekt-credentials-panel';
import { SubiektStructuredSection } from './components/subiekt-structured-section';
import { SubiektInvoiceDetailSection } from './components/subiekt-invoice-detail-section';
import { SubiektInvoiceCorrectionFlow } from './components/subiekt-invoice-correction-flow';
import { SUBIEKT_CAPABILITY_DESCRIPTORS } from './subiekt-capability-descriptors';
import { subiektConnectionConfig } from './subiekt-connection-config';

export const subiektNexoPlugin: OpenLinkerPlugin = definePlugin({
  id: 'subiekt-nexo',
  platformType: 'subiekt-nexo',
  build: {
    routes: [subiektNexoSetupRoute],
  },
  platform: {
    displayName: 'Subiekt nexo (Sfera bridge)',
    setupCard: {
      title: 'Subiekt nexo',
      description:
        'Issue invoices in Subiekt nexo through the OpenLinker Sfera bridge running on your Windows machine.',
      to: '/connections/new/subiekt-nexo',
      badge: 'Sfera bridge',
    },
    capabilityDescriptors: SUBIEKT_CAPABILITY_DESCRIPTORS,
    connectionConfig: subiektConnectionConfig,
    StructuredConfigSection: SubiektStructuredSection,
    CredentialsPanel: SubiektCredentialsPanel,
    invoiceDetailSection: SubiektInvoiceDetailSection,
    invoiceCorrectionFlow: SubiektInvoiceCorrectionFlow,
  },
});
