/**
 * Analytics infotip
 *
 * Click-to-open definition popover for a KPI card's eyebrow (ⓘ).
 *
 * Since #3268 this is a thin alias over the shared `Infotip` primitive rather
 * than its own copy of the markup: a second consumer appeared (the eparagony.pl
 * connection form's tax-fallback hazard), and two copies would have meant
 * fixing the unnamed `role="dialog"` twice. Kept as a named export so the
 * analytics call sites and `display-currency.lib.ts` read in their own
 * vocabulary.
 *
 * @module features/analytics/components
 */
export { Infotip as AnalyticsInfotip } from '../../../shared/ui/infotip';
export type {
  InfotipDefinition as AnalyticsInfotipDefinition,
  InfotipProps as AnalyticsInfotipProps,
} from '../../../shared/ui/infotip';
