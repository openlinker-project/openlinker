/**
 * eparagony.pl plugin (#1911)
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
 * affordance of its own. No invoice-panel
 * slots either: the fiscal receipt surface (#1909) mounts directly on the
 * order page, the same way `OrderInvoicePanel` does, not through a
 * per-provider plugin slot. (#2160: that surface is now the `orders`
 * feature's `SalesDocumentPanel`, not a standalone `OrderReceiptPanel`.)
 *
 * @module plugins/eparagony
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
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
  },
});
