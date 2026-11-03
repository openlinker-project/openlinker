/**
 * Batched document kinds of a connection (#3583, epic #3515)
 *
 * The concrete kinds a connection issues (its `salesDocument.documentKind`,
 * `both` meaning invoices and receipts) whose trigger model resolves to
 * `batched` (#3582). ONE definition, read by the scheduler's tick (which kinds
 * to run on a slot) and by "Run now" (which kinds a manual run covers), so the
 * two cannot disagree about what a connection batches.
 *
 * Pure: a function of the connection's config alone.
 *
 * @module libs/core/src/orders/domain
 */
import { resolveTriggerModelForKind } from '@openlinker/core/invoicing';
import {
  readSalesDocumentRouting,
  type SalesDocumentKind,
} from '@openlinker/core/sales-documents';

/** The concrete kinds a connection's routing config says it issues. */
export function documentKindsIssuedBy(config: unknown): SalesDocumentKind[] {
  const { documentKind } = readSalesDocumentRouting(config);
  if (documentKind === 'both') return ['invoice', 'fiscal-receipt'];
  if (documentKind === 'invoice' || documentKind === 'fiscal-receipt') return [documentKind];
  return [];
}

/** The kinds this connection issues in batches. */
export function batchedDocumentKinds(config: unknown): SalesDocumentKind[] {
  return documentKindsIssuedBy(config).filter(
    (kind) => resolveTriggerModelForKind(config, kind).model === 'batched',
  );
}
