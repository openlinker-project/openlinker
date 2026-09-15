/**
 * eparagony.pl plugin (#1911, invoicing slot #3192)
 *
 * Contributes the guided setup route + setup card. No structured-config
 * section or credentials panel yet - every config field beyond the guided
 * wizard's `environment`/`posId` is either rare (`taxRates`,
 * `fiscalDeviceUniqueNumber`) or regime-specific enough to leave to the
 * generic raw-JSON config editor for v1, matching how the Erli plugin defers
 * most of its config surface the same way.
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
    invoiceDetailSection: EparagonyInvoiceDetailSection,
  },
});
