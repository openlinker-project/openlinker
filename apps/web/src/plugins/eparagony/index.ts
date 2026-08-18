/**
 * eparagony.pl plugin (#1911)
 *
 * Contributes the guided setup route + setup card for the Fiscalization
 * capability. No structured-config section or credentials panel yet - every
 * config field beyond the guided wizard's `environment`/`posId` is either
 * rare (`taxRates`, `fiscalDeviceUniqueNumber`) or regime-specific enough to
 * leave to the generic raw-JSON config editor for v1, matching how the Erli
 * plugin defers most of its config surface the same way. No invoice-panel
 * slots either: the fiscal receipt surface (#1909) mounts directly on the
 * order page, the same way `OrderInvoicePanel` does, not through a
 * per-provider plugin slot. (#2160: that surface is now the `orders`
 * feature's `SalesDocumentPanel`, not a standalone `OrderReceiptPanel`.)
 *
 * @module plugins/eparagony
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
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
  },
});
