/**
 * Subiekt plugin (#759)
 *
 * Platform-side contributions for Subiekt connections: display name, the
 * adapter-provided capability descriptors (AC-8), the structured-config
 * section (Bridge URL + trigger model + capability toggles), and the
 * Bearer bridge-token credentials panel.
 *
 * NO setup route (out of scope: bridge MSI installer / auto-discovery) and
 * NO `ConnectionActions` slot — the generic detail-page actions panel already
 * exposes the connection-test (Decision 8). #759 is FE-only; the BE Subiekt
 * adapter + tester registration is #753.
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
import { SubiektCredentialsPanel } from './components/subiekt-credentials-panel';
import { SubiektStructuredSection } from './components/subiekt-structured-section';
import { SUBIEKT_CAPABILITY_DESCRIPTORS } from './subiekt-capability-descriptors';

export const subiektPlugin: OpenLinkerPlugin = definePlugin({
  id: 'subiekt',
  platformType: 'subiekt',
  platform: {
    displayName: 'Subiekt',
    capabilityDescriptors: SUBIEKT_CAPABILITY_DESCRIPTORS,
    StructuredConfigSection: SubiektStructuredSection,
    CredentialsPanel: SubiektCredentialsPanel,
  },
});
