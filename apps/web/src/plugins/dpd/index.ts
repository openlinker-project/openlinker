/**
 * DPD Polska plugin
 *
 * First **carrier (shipping-only)** FE plugin (#966). DPD declares only the
 * `ShippingProviderManager` capability, so it contributes no marketplace
 * slots — just the guided setup route (build-time), the platform display name +
 * setup card, and a credentials panel for the DPDServices login/password pair.
 *
 * Structured config *editing* is intentionally not contributed — DPD config
 * (environment / payer FID / sender address) is set at create time via the
 * guided wizard; the edit form falls back to the generic raw-JSON config block
 * for the rare post-create change. `pickupPointResolvesAsync` is omitted: DPD
 * Pickup points are operator-selected, so the panel caption reads
 * "operator-selected" with no special logic.
 *
 * @module plugins/dpd
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { dpdMessages, getDpdMessages } from './messages';
import { DpdCredentialsPanel } from './components/dpd-credentials-panel';
import { dpdSetupRoute } from './dpd-setup.route';

export const dpdPlugin: OpenLinkerPlugin = definePlugin({
  id: 'dpd',
  messages: dpdMessages,
  platformType: 'dpd',
  build: {
    routes: [dpdSetupRoute],
  },
  platform: {
    displayName: 'DPD Polska',
    // Getters, not values: the card is read at render, so the copy follows
    // the active language instead of freezing at module load.
    setupCard: {
      title: 'DPD Polska',
      get description(): string {
        return getDpdMessages().plugin.setupCard.description;
      },
      to: '/connections/new/dpd',
      get badge(): string {
        return getDpdMessages().plugin.setupCard.badge;
      },
    },
    CredentialsPanel: DpdCredentialsPanel,
  },
});
