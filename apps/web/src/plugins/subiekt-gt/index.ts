/**
 * Subiekt plugin (#1199 + #759)
 *
 * Contributes BOTH halves of the Subiekt platform surface:
 *  - the guided connection wizard so it appears on the connection-type picker
 *    (`/connections/new`) instead of advanced-mode only: a `setupCard` + a
 *    guided `build.routes` entry (#1199);
 *  - the connection-settings edit surface (#759): the adapter-provided
 *    capability descriptors (AC-8), the structured-config section (Bridge URL +
 *    trigger model + capability toggles), and the Bearer bridge-token
 *    credentials panel.
 * Subiekt GT is reached through the OpenLinker Sfera GT bridge (BE adapter
 * `subiekt.gt.v1`, platformType `subiekt-gt`; tester registration #753).
 * Subiekt nexo is a DIFFERENT product with a different bridge and a different
 * wire contract - it has no adapter here, and if one is built it gets its own
 * plugin, its own id and its own platformType.
 *
 * Operator copy lives in the plugin's own `subiekt-gt` namespace
 * (`locales/en.json`, ADR-081).
 *
 * @module plugins/subiekt-gt
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { getSubiektGtMessages, subiektGtMessages } from './messages';
import { subiektSetupRoute } from './subiekt-setup.route';
import { SubiektCredentialsPanel } from './components/subiekt-credentials-panel';
import { SubiektStructuredSection } from './components/subiekt-structured-section';
import { SubiektInvoiceDetailSection } from './components/subiekt-invoice-detail-section';
import { SubiektInvoiceCorrectionFlow } from './components/subiekt-invoice-correction-flow';
import { SUBIEKT_CAPABILITY_DESCRIPTORS } from './subiekt-capability-descriptors';
import { subiektConnectionConfig } from './subiekt-connection-config';

export const subiektPlugin: OpenLinkerPlugin = definePlugin({
  // `subiekt-gt`, matching the backend manifest exactly. Subiekt GT and
  // Subiekt nexo are two separate entities and are never joined: the nexo
  // plugin lives at `plugins/subiekt-nexo/` and carries its own id and
  // platformType rather than sharing these.
  id: 'subiekt-gt',
  platformType: 'subiekt-gt',
  messages: subiektGtMessages,
  build: {
    routes: [subiektSetupRoute],
  },
  platform: {
    displayName: 'Subiekt GT (Sfera GT bridge)',
    // The bridge is how it is reached, not what it is: the chip face says the platform.
    shortLabel: 'Subiekt GT',
    // Getters, not values: the card is read at render, so the copy follows
    // the active language instead of freezing at module load.
    setupCard: {
      title: 'Subiekt GT',
      get description(): string {
        return getSubiektGtMessages().plugin.setupCard.description;
      },
      to: '/connections/new/subiekt-gt',
      get badge(): string {
        return getSubiektGtMessages().plugin.setupCard.badge;
      },
    },
    capabilityDescriptors: SUBIEKT_CAPABILITY_DESCRIPTORS,
    connectionConfig: subiektConnectionConfig,
    StructuredConfigSection: SubiektStructuredSection,
    CredentialsPanel: SubiektCredentialsPanel,
    invoiceDetailSection: SubiektInvoiceDetailSection,
    invoiceCorrectionFlow: SubiektInvoiceCorrectionFlow,
  },
});
