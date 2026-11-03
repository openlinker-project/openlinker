/**
 * Resolve Trigger Model For Kind (#3582)
 *
 * Browser mirror of core's `resolveTriggerModelForKind`
 * (`libs/core/src/invoicing/domain/types/invoice-trigger.types.ts`). The web
 * bundle cannot import `@openlinker/core` (#591), and every screen that shows
 * or edits a trigger model must show the value the auto-issue gate will
 * actually use, so the precedence lives here a second time:
 *
 *   `config.salesDocument.triggerModels[kind]` → legacy
 *   `config.invoicing.triggerModel` → `manual`
 *
 * Each rung counts only when it holds a recognised model, so an unrecognised
 * kind-scoped value falls through to the legacy one. Both specs run the same
 * case table; change them together.
 *
 * Lives in `connections` rather than `sales-documents` because the Subiekt
 * connection form needs it too, and `connections` must not import
 * `sales-documents` (which already imports `connections`).
 *
 * @module apps/web/src/features/connections/lib
 */
import {
  INVOICE_TRIGGER_MODEL_VALUES,
  type InvoiceTriggerModel,
} from '../types/invoice-trigger-model.types';

export const TRIGGER_MODEL_SOURCE_VALUES = ['kind', 'legacy', 'default'] as const;
export type TriggerModelSource = (typeof TRIGGER_MODEL_SOURCE_VALUES)[number];

export interface ResolvedTriggerModel {
  model: InvoiceTriggerModel;
  source: TriggerModelSource;
}

function isInvoiceTriggerModel(value: unknown): value is InvoiceTriggerModel {
  return (
    typeof value === 'string' && (INVOICE_TRIGGER_MODEL_VALUES as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveTriggerModelForKind(config: unknown, kind: string): ResolvedTriggerModel {
  const record = isRecord(config) ? config : {};
  const salesDocument = isRecord(record.salesDocument) ? record.salesDocument : {};
  const byKind = isRecord(salesDocument.triggerModels) ? salesDocument.triggerModels : {};

  const scoped = byKind[kind];
  if (isInvoiceTriggerModel(scoped)) {
    return { model: scoped, source: 'kind' };
  }

  const invoicing = isRecord(record.invoicing) ? record.invoicing : {};
  if (isInvoiceTriggerModel(invoicing.triggerModel)) {
    return { model: invoicing.triggerModel, source: 'legacy' };
  }

  return { model: 'manual', source: 'default' };
}

/**
 * Write one kind's trigger model into a config's `salesDocument.triggerModels`,
 * preserving every other key. An empty `value` removes that kind's entry, and an
 * emptied `triggerModels` / `salesDocument` object is dropped. The legacy
 * `invoicing.triggerModel` is never touched: it may still be the fallback for
 * another kind.
 */
export function writeTriggerModelForKind(
  config: Record<string, unknown>,
  kind: string,
  value: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  const salesDocument: Record<string, unknown> = isRecord(config.salesDocument)
    ? { ...config.salesDocument }
    : {};
  const byKind: Record<string, unknown> = isRecord(salesDocument.triggerModels)
    ? { ...salesDocument.triggerModels }
    : {};

  if (value.length === 0) {
    delete byKind[kind];
  } else {
    byKind[kind] = value;
  }

  if (Object.keys(byKind).length === 0) {
    delete salesDocument.triggerModels;
  } else {
    salesDocument.triggerModels = byKind;
  }

  if (Object.keys(salesDocument).length === 0) {
    delete next.salesDocument;
  } else {
    next.salesDocument = salesDocument;
  }

  return next;
}
