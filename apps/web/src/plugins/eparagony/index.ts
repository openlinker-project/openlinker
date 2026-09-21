/**
 * eparagony.pl plugin (#1911, invoicing slot #3192)
 *
 * Contributes the guided setup route + setup card for the Fiscalization
 * capability, plus the structured-config section (#3266).
 *
 * That section reverses this file's original v1 position, which deferred every
 * config field beyond the wizard's `environment`/`posId` to the generic raw-JSON
 * editor. The deferral did not hold up: `print`, `paymentForm` and
 * `defaultTaxRateCode` are fiscal settings an operator is expected to get right,
 * and hand-writing JSON is not a setup step most operators can complete - the
 * same finding #2610 made about `stockSafetyBuffer` / `pricingRule`. `taxRates`
 * remains raw-JSON-only on purpose: it describes the seller's physical device
 * programming rather than a product's VAT rate.
 *
 * Still no credentials panel - eparagony.pl registers no credentials-shape
 * affordance of its own.
 *
 * The FISCAL RECEIPT surface still mounts directly on the order page (#1909),
 * the way `OrderInvoicePanel` did, rather than through a per-provider plugin
 * slot - since #2160 that surface is the `orders` feature's
 * `SalesDocumentPanel`, not a standalone `OrderReceiptPanel`.
 *
 * The INVOICE surface does go through the slot, because the adapter grew an
 * `InvoicingPort` implementation (#3192) and the two facts it adds are
 * provider-specific by nature: that this provider publishes no call to
 * (re-)trigger transmission, and that its issued-document link is an HTML
 * visualisation rather than a PDF. Both live in
 * `EparagonyInvoiceDetailSection`; neither belongs in a shared component.
 *
 * @module plugins/eparagony
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { EparagonyInvoiceDetailSection } from './components/eparagony-invoice-detail-section';
import { EparagonyStructuredSection } from './components/eparagony-structured-section';
import { eparagonyConnectionConfig } from './eparagony-connection-config';
import { eparagonySetupRoute } from './eparagony-setup.route';

export const eparagonyPlugin: OpenLinkerPlugin = definePlugin({
  id: 'eparagony',
  platformType: 'eparagony',
  build: {
    routes: [eparagonySetupRoute],
  },
  platform: {
    displayName: 'eparagony.pl',
    setupCard: {
      title: 'eparagony.pl',
      description: 'Register Polish fiscal e-receipts against your own fiscal printer.',
      to: '/connections/new/eparagony',
      badge: 'Fiscalization',
    },
    StructuredConfigSection: EparagonyStructuredSection,
    connectionConfig: eparagonyConnectionConfig,
    invoiceDetailSection: EparagonyInvoiceDetailSection,
  },
});
