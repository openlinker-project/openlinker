/**
 * Document Number Consumer Capability
 *
 * Optional sub-capability of `InvoicingPort` (#1575): an invoicing adapter that
 * relies on OpenLinker to supply the legal, sequential document number for each
 * issued document declares `implements DocumentNumberConsumer`. When the resolved
 * adapter passes `isDocumentNumberConsumer`, the core `InvoiceService` allocates a
 * number from the connection's numbering series and sets
 * `IssueInvoiceCommand.documentNumber`; the adapter consumes it verbatim (KSeF:
 * FA(3) `P_2`). Providers that number documents themselves (inFakt/Subiekt) do
 * NOT implement it and keep their own provider-assigned number — numbering is
 * opt-in per adapter, never forced onto a provider with its own series.
 *
 * Neutral-vocabulary litmus (ADR-026): no provider/country vocabulary here — a
 * document number is a neutral commercial concept.
 *
 * MARKER shape: the capability carries no methods, so it cannot be duck-typed by
 * method presence like the sibling capabilities. It instead exposes a single
 * `readonly` discriminant (`consumesDocumentNumber: true`) that the guard reads —
 * the minimum a runtime type-guard needs to distinguish a marker capability.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';

export interface DocumentNumberConsumer {
  /**
   * Discriminant flag (always `true`) marking the adapter as an OpenLinker-
   * numbered provider. Read by {@link isDocumentNumberConsumer}; a pure marker
   * interface would be invisible to a runtime guard.
   */
  readonly consumesDocumentNumber: true;

  /**
   * IANA timezone (e.g. `'Europe/Warsaw'`) the numbering date variables and the
   * period-reset bucket resolve in (#7). The provider adapter owns this value —
   * resolved from its connection config with a provider-appropriate default —
   * so core never hardcodes a seller timezone. The core `InvoiceService` threads
   * it into the allocation's render context.
   */
  readonly numberingTimeZone: string;

  /**
   * Optional max length the provider accepts for a document number (#11) — e.g.
   * KSeF's FA(3) `P_2` limit of 256. When set, the core allocation validates the
   * rendered number against it and throws `DocumentNumberTooLongException` before
   * the provider boundary; absent = no OL-side length guard.
   */
  readonly maxDocumentNumberLength?: number;
}

export function isDocumentNumberConsumer(
  adapter: InvoicingPort,
): adapter is InvoicingPort & DocumentNumberConsumer {
  return (adapter as Partial<DocumentNumberConsumer>).consumesDocumentNumber === true;
}
