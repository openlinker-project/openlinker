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
 * ---
 * I18N — PL strings DEFERRED (AC "PL + EN locale strings").
 *
 * Every human-facing string in this plugin is already routed through the host
 * i18n seam as `t('subiekt.settings.*', '<English fallback>')` — see
 * `subiekt-structured-section.tsx`, `subiekt-credentials-panel.tsx`, and the
 * `subiekt.settings.triggerModel.*` keys derived from
 * `INVOICE_TRIGGER_MODEL_LABELS`. The seam is the architecturally-correct
 * localization boundary and the key namespace is stable.
 *
 * What is NOT delivered: actual Polish content. The host
 * (`shared/i18n/locale-provider.tsx`) ships a frozen EMPTY_CATALOG, exposes no
 * `setLocale`/locale switcher, and has no per-locale catalog loader
 * (`LocaleCodeValues === ['en']`). So today `t()` always returns its English
 * fallback for every consumer in the app, not just Subiekt.
 *
 * Shipping live PL strings is therefore a HOST change (a `pl` catalog +
 * loader + persistence + a `LocaleSwitcher`), which the host deferred in
 * #612 and is out of scope for this FE feature. Because the `t()` keys here
 * are stable, a PL catalog keyed on `subiekt.settings.*` can be registered via
 * `LocaleProvider`'s `catalog` prop later WITHOUT editing any #759 component.
 * AC explicitly recorded as deferred — not silently unmet.
 *
 * @module plugins/subiekt-gt
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { subiektSetupRoute } from './subiekt-setup.route';
import { SubiektCredentialsPanel } from './components/subiekt-credentials-panel';
import { SubiektStructuredSection } from './components/subiekt-structured-section';
import { SubiektInvoiceDetailSection } from './components/subiekt-invoice-detail-section';
import { SubiektInvoiceCorrectionFlow } from './components/subiekt-invoice-correction-flow';
import { SUBIEKT_CAPABILITY_DESCRIPTORS } from './subiekt-capability-descriptors';
import { subiektConnectionConfig } from './subiekt-connection-config';

export const subiektPlugin: OpenLinkerPlugin = definePlugin({
  // `subiekt-gt`, matching the backend manifest exactly. Subiekt GT and
  // Subiekt nexo are two separate entities and are never joined: a nexo
  // plugin, if one is ever built, registers its own id and platformType here
  // rather than sharing these.
  id: 'subiekt-gt',
  platformType: 'subiekt-gt',
  build: {
    routes: [subiektSetupRoute],
  },
  platform: {
    displayName: 'Subiekt GT (Sfera GT bridge)',
    setupCard: {
      title: 'Subiekt GT',
      description:
        'Connect Subiekt GT through the OpenLinker bridge on your Windows machine: read the product catalogue and stock levels, receive orders, and issue invoices and receipts with their warehouse release.',
      to: '/connections/new/subiekt-gt',
      badge: 'Sfera GT bridge',
    },
    capabilityDescriptors: SUBIEKT_CAPABILITY_DESCRIPTORS,
    connectionConfig: subiektConnectionConfig,
    StructuredConfigSection: SubiektStructuredSection,
    CredentialsPanel: SubiektCredentialsPanel,
    invoiceDetailSection: SubiektInvoiceDetailSection,
    invoiceCorrectionFlow: SubiektInvoiceCorrectionFlow,
  },
});
