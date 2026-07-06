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
 * Subiekt nexo issues invoices via the OpenLinker Sfera bridge (BE adapter
 * `subiekt.invoicing.v1`, capability `Invoicing`; tester registration #753).
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
 * @module plugins/subiekt
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
  id: 'subiekt',
  platformType: 'subiekt',
  build: {
    routes: [subiektSetupRoute],
  },
  platform: {
    displayName: 'Subiekt nexo',
    setupCard: {
      title: 'Subiekt nexo',
      description:
        'Issue invoices in Subiekt nexo via the OpenLinker Sfera bridge running on your Windows machine.',
      to: '/connections/new/subiekt',
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
