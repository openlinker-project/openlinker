/**
 * Invoice Trigger Model Types (#759)
 *
 * Connection-layer source of truth for the AC-2 invoice trigger models.
 * Mirrors the live BE source of truth:
 *   `libs/core/dist/identifier-mapping/domain/types/invoice-trigger-model.types`
 *   (`INVOICE_TRIGGER_MODELS` / `getInvoiceTriggerModel`).
 *
 * That type is NOT in `libs/core/src` on this branch (dist only), so we mirror
 * the 4 values here. A plugin invariant test asserts this stays in lockstep.
 *
 * Lives in the FEATURE layer (not the Subiekt plugin) so the connection Zod
 * schema and `EditConnectionForm` can validate `subiektTriggerModel` without
 * importing UP into `plugins/` (which the FE layering / lint rule forbids —
 * `app → pages → features → shared`; plugins compose features, never the
 * reverse). Mirrors the `POLISH_VOIVODESHIP_VALUES` placement. The Subiekt
 * plugin re-exports these from here (plugin → feature is allowed).
 *
 * PERSISTENCE PATH: the selected model persists at NESTED `config.invoicing.triggerModel`
 * (NOT a flat `config.subiektTriggerModel`). The BE reader `getInvoiceTriggerModel`
 * reads `config['invoicing']['triggerModel']` and defaults to `'manual'` when
 * absent/unrecognized. A flat key would be silently ignored → always `'manual'`.
 */
import { getMessages } from '../../../shared/i18n';


export const INVOICE_TRIGGER_MODEL_VALUES = [
  'manual',
  'auto-on-paid',
  'auto-on-shipped',
  'batched',
] as const;

export type InvoiceTriggerModel = (typeof INVOICE_TRIGGER_MODEL_VALUES)[number];

/**
 * AC-2 trigger dropdown labels, read from
 * `connections.invoiceTriggerModel.labels` in the active language each time
 * an entry is read.
 */
export const INVOICE_TRIGGER_MODEL_LABELS = Object.defineProperties(
  {} as Record<InvoiceTriggerModel, string>,
  Object.fromEntries(
    INVOICE_TRIGGER_MODEL_VALUES.map((value) => [
      value,
      {
        enumerable: true,
        get: (): string => getMessages('connections').invoiceTriggerModel.labels[value],
      },
    ]),
  ),
);
