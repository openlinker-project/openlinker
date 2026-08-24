/**
 * Merge Sales Document Config (#2159)
 *
 * Applies a `SalesDocumentConfigPatch` onto a connection's freshly-fetched
 * `config`, producing the full config object to PATCH back — the same
 * fetch-fresh-then-merge shape `EditConnectionForm.onSubmit` and
 * `syncInvoicingPrimaryToJson` use, since `PATCH /connections/:id` replaces
 * `config` wholesale rather than deep-merging server-side (confirmed via
 * `ConnectionService.update` → `connectionPort.update`). Merging only the two
 * nested keys this page owns (`invoicing`, `salesDocument`) preserves every
 * other config key a sibling section may have written
 * (`rateLimit`, `pricingRule`, `stockSafetyBuffer`, platform-specific fields, …).
 *
 * An empty-string `documentKind` ("Nothing" in the Issues select) DELETES the
 * key rather than writing `''` — `readSalesDocumentRouting` on the backend
 * treats a blank string identically to a missing key, but writing `undefined`
 * through `JSON.stringify` at the HTTP boundary would drop the key anyway;
 * doing it explicitly here keeps the in-memory object honest for tests.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentConfigPatch } from '../api/sales-documents.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function mergeSalesDocumentConfig(
  existingConfig: Record<string, unknown>,
  patch: SalesDocumentConfigPatch,
): Record<string, unknown> {
  const invoicing = isRecord(existingConfig.invoicing) ? { ...existingConfig.invoicing } : {};
  const salesDocument = isRecord(existingConfig.salesDocument)
    ? { ...existingConfig.salesDocument }
    : {};

  if (patch.isPrimary !== undefined) {
    invoicing.isPrimary = patch.isPrimary;
  }
  if (patch.triggerModel !== undefined) {
    invoicing.triggerModel = patch.triggerModel;
  }
  if (patch.documentKind !== undefined) {
    if (patch.documentKind === '') {
      delete salesDocument.documentKind;
    } else {
      salesDocument.documentKind = patch.documentKind;
    }
  }

  return { ...existingConfig, invoicing, salesDocument };
}
