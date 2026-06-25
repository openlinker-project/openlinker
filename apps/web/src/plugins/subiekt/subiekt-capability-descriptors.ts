/**
 * Subiekt plugin — capability descriptors + trigger-model mirror (#759)
 *
 * AC-8 international-safety boundary: the human-facing capability labels
 * (e.g. 'Show KSeF status badge') live HERE, in the provider-supplied
 * descriptor map, NEVER as literals in the shared `CapabilityTogglesSection`.
 * The generic section reads its labels from `PlatformContribution.capabilityDescriptors`.
 *
 * @module plugins/subiekt
 */

/**
 * Invoice trigger models — the VALUES live in the connection FEATURE layer
 * (`features/connections/types/invoice-trigger-model.types.ts`), so the host
 * schema/form can validate them WITHOUT importing up into `plugins/` (the FE
 * layering forbids feature → plugin). The plugin re-exports them here under
 * its own names (plugin → feature is allowed) so the Subiekt section's
 * <Select> keeps a stable plugin-local import.
 *
 * PERSISTENCE PATH: the selected model persists at NESTED `config.invoicing.triggerModel`
 * (NOT a flat `config.subiektTriggerModel`). The BE reader `getInvoiceTriggerModel`
 * reads `config['invoicing']['triggerModel']` and defaults to `'manual'` when
 * absent/unrecognized. A flat key would be silently ignored → always `'manual'`.
 */
import {
  INVOICE_TRIGGER_MODEL_VALUES,
  INVOICE_TRIGGER_MODEL_LABELS,
  type InvoiceTriggerModel,
} from '../../features/connections';

export const SUBIEKT_TRIGGER_MODELS = INVOICE_TRIGGER_MODEL_VALUES;

export type SubiektTriggerModel = InvoiceTriggerModel;

/**
 * AC-2 trigger dropdown labels. Routed through `t(key, fallback)` at render
 * time; the English fallback lives in the feature-layer types module.
 */
export const SUBIEKT_TRIGGER_MODEL_LABELS: Record<SubiektTriggerModel, string> =
  INVOICE_TRIGGER_MODEL_LABELS;

/**
 * Adapter-provided capability descriptors (AC-8). Keyed by capability id;
 * persists per-key under `config.capabilities.<key> = boolean`.
 *
 * The regulatory-transmission-tracking capability surfaces the bridge-native
 * KSeF status badge (provider-supplied concept — the label is supplied here,
 * never hardcoded in the shared component).
 */
export const SUBIEKT_CAPABILITY_DESCRIPTORS: Record<string, { label: string; help?: string }> = {
  'regulatory-transmission-tracking': {
    label: 'Show KSeF status badge',
    help: 'Surface the bridge-reported regulatory transmission (KSeF) status on orders for this connection.',
  },
};
