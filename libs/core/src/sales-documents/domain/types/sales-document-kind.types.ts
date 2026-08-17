/**
 * Sales-Document Kind Types (#2155, ADR-041 decisions 4 + 10)
 *
 * The router's own discriminator — deliberately NOT `IssueInvoiceCommand.documentType`.
 * Which kind implies which capability to dispatch to (`Invoicing` vs the
 * fiscalization capability); keeping the two vocabularies distinct is
 * load-bearing, not pedantic: a fiscal receipt is explicitly NOT an
 * `InvoicingPort` `DocumentType` (#1902/#1908 — different issuer, device
 * dependency, legal basis), while ADR-026 §Decision 1 places `'receipt'`
 * inside the invoicing union — so keying routing on `documentType` would
 * quietly re-model a receipt as an invoicing document. The spelling
 * `'fiscal-receipt'` deliberately differs from `DocumentTypeValues`' `'receipt'`
 * for the same reason: a grep must never make the two vocabularies look
 * interchangeable.
 *
 * OPEN-WORLD, not a closed union (mirrors capability #576 / platformType
 * #578/#579): a regime with a third originating document (a per-transaction
 * register entry, a simplified invoice treated as its own document, an
 * aggregate daily report) is additive — an adapter/regime can declare a kind
 * core has never seen. Consequently "validity is a runtime check against the
 * target, never a type check" (ADR-041 decision 10) — see
 * `resolveSalesDocumentRouting`'s structural capability check for the one
 * purely-structural slice of that validation this concern can perform without
 * any I/O; the deeper check (an adapter actually listing the kind as
 * supported) stays with the future gate.
 *
 * `readSalesDocumentRouting` is the operator-configuration reader (decision
 * 4): per connection, which kind it issues, and whether it is the
 * operator-set primary. It reads the SAME `config.invoicing.isPrimary` shape
 * #2047 already writes (decision 4 fixes that shape, it does not introduce a
 * second one). This file deliberately does NOT import `ConnectionConfig` from
 * `@openlinker/core/identifier-mapping` — doing so would break this concern's
 * dependency-free-leaf property (see `sales-document-reason.types.ts` and
 * `libs/core/src/__tests__/barrel-purity.spec.ts`) for no benefit, since
 * `ConnectionConfig` carries an open index signature anyway. It reads the raw
 * `unknown` JSONB value the same way `parseIsPrimaryInvoicing` /
 * `parseTriggerModel` do (`libs/core/src/invoicing/domain/types/`).
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */

/** Well-known sales-document kinds core recognizes structurally (decision 10). */
export const CoreSalesDocumentKindValues = ['invoice', 'fiscal-receipt'] as const;

export type CoreSalesDocumentKind = (typeof CoreSalesDocumentKindValues)[number];

/**
 * Open string set: well-known values come from `CoreSalesDocumentKindValues`,
 * but a regime/adapter may declare a kind core has never seen (ADR-041
 * decision 10) — never a closed union, on the same precedent as `Capability`
 * (#576) and `PlatformType` (#578/#579).
 *
 * ADR-041 decision 10 pins this exact shape (`CoreSalesDocumentKind | string`)
 * verbatim, rather than the bare-`string`-with-documented-literals shape used
 * elsewhere for the same open-world pattern (e.g. `InfaktWebhookEventName`) —
 * keeping the literals IN the union (not just documented alongside it) is
 * what still gives editors 'invoice' / 'fiscal-receipt' autocomplete while
 * remaining assignable from any string.
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- ADR-041 decision 10 requires this exact union shape (see doc comment above); `string` is not redundant in intent even though it is in structural assignability.
export type SalesDocumentKind = CoreSalesDocumentKind | string;

/**
 * Per-connection sales-document routing configuration, resolved from
 * `Connection.config` (decision 4).
 *
 * - `documentKind` — which kind THIS connection issues, or `null` when the
 *   operator has not configured one (the connection is not a routing
 *   candidate at all).
 * - `isPrimary` — whether this connection is the operator-set tiebreaker
 *   among several candidates. Reads the identical `config.invoicing.isPrimary`
 *   shape #2047 already writes.
 */
export interface SalesDocumentRoutingConfig {
  readonly documentKind: SalesDocumentKind | null;
  readonly isPrimary: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read a connection's sales-document routing configuration from its raw,
 * untrusted `config` JSONB value. Pure, no I/O — mirrors the
 * `parseTriggerModel` / `parseIsPrimaryInvoicing` coercion precedent.
 *
 * `isPrimary` reads `config.invoicing.isPrimary` — the EXACT shape #2047
 * already writes (decision 4 fixes that shape, it does not introduce a second
 * one); a real `true` or the string `'true'` (how a hand-edited JSON config
 * arrives) counts, anything else is `false`.
 *
 * `documentKind` reads the new `config.salesDocument.documentKind` key — a
 * non-empty string is trusted verbatim (open-world, decision 10); anything
 * missing, blank, or non-string coerces to `null` (not a routing candidate).
 */
export function readSalesDocumentRouting(config: unknown): SalesDocumentRoutingConfig {
  const record = isRecord(config) ? config : {};
  const invoicing = isRecord(record.invoicing) ? record.invoicing : {};
  const salesDocument = isRecord(record.salesDocument) ? record.salesDocument : {};

  const isPrimary = invoicing.isPrimary === true || invoicing.isPrimary === 'true';

  const rawKind = salesDocument.documentKind;
  const documentKind = typeof rawKind === 'string' && rawKind.trim().length > 0 ? rawKind : null;

  return { documentKind, isPrimary };
}
