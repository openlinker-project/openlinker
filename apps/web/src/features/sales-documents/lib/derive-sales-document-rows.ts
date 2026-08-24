/**
 * Derive Sales Document Rows (#2159)
 *
 * Pure projection from the generic `Connection[]` list (as returned by
 * `useConnectionsQuery`) to the rows the centralized "Settings → Sales
 * documents" table renders. Mirrors the raw-JSONB reading shape of the
 * backend's `readSalesDocumentRouting` (`@openlinker/core/sales-documents`) —
 * this file cannot import that (apps/web never imports `@openlinker/core/*`),
 * so the coercion rules are duplicated here deliberately, not accidentally.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { Connection } from '../../connections';
import type { SalesDocumentCapability, SalesDocumentKind, SalesDocumentRow } from '../api/sales-documents.types';
import { SALES_DOCUMENT_KIND_VALUES } from '../api/sales-documents.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveCapability(connection: Connection): SalesDocumentCapability | null {
  if (connection.enabledCapabilities.includes('Invoicing')) return 'Invoicing';
  if (connection.enabledCapabilities.includes('Fiscalization')) return 'Fiscalization';
  return null;
}

function isSalesDocumentKind(value: unknown): value is SalesDocumentKind {
  return (SALES_DOCUMENT_KIND_VALUES as readonly unknown[]).includes(value);
}

/**
 * Every connection with `Invoicing` or `Fiscalization` enabled, reduced to
 * the routing facts the table edits. A connection with neither capability
 * (or disabled entirely — capability enablement is a separate axis from
 * connection `status`) is not a routing candidate and is excluded.
 */
export function deriveSalesDocumentRows(connections: readonly Connection[]): SalesDocumentRow[] {
  const rows: SalesDocumentRow[] = [];

  for (const connection of connections) {
    const capability = resolveCapability(connection);
    if (capability === null) continue;

    const invoicing = isRecord(connection.config.invoicing) ? connection.config.invoicing : {};
    const salesDocument = isRecord(connection.config.salesDocument)
      ? connection.config.salesDocument
      : {};

    const rawKind = salesDocument.documentKind;
    const documentKind = isSalesDocumentKind(rawKind) ? rawKind : null;

    const isPrimary = invoicing.isPrimary === true || invoicing.isPrimary === 'true';

    const rawTrigger = invoicing.triggerModel;
    const triggerModel = typeof rawTrigger === 'string' && rawTrigger.trim().length > 0
      ? rawTrigger
      : 'manual';

    rows.push({
      connectionId: connection.id,
      name: connection.name,
      platformType: connection.platformType,
      status: connection.status,
      capability,
      documentKind,
      isPrimary,
      triggerModel,
    });
  }

  return rows;
}
