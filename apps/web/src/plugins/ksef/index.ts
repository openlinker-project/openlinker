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
 *
 * Per ADR-026, the FE never reasons about Polish specifics through
 * `platformType === 'ksef'` string-matching in shared components — every
 * platform-specific affordance is resolved through the registry via
 * `usePlatform('ksef')`. The invoice surfacing on the order-detail page is
 * neutral-field-gated (presence of `regulatoryStatus` / `clearanceReference`),
 * not gated on this platform type — see
 * `features/orders/components/order-invoice-panel.tsx`.
 *
 * @module plugins/ksef
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { KsefCredentialsPanel } from './components/ksef-credentials-panel';
import { KsefStructuredSection } from './components/ksef-structured-section';
import { ksefSetupRoute } from './ksef-setup.route';

export const ksefPlugin: OpenLinkerPlugin = definePlugin({
  id: 'ksef',
  platformType: 'ksef',
  build: {
    routes: [ksefSetupRoute],
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
    CredentialsPanel: KsefCredentialsPanel,
  },
});
