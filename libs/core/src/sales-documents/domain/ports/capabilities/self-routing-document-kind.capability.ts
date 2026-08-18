/**
 * Self-Routing Document Kind Capability (#2158, ADR-041 decision 9)
 *
 * A destination that decides its OWN originating-document kind at issuance
 * time, rather than being handed one by `resolveSalesDocumentRouting`. Declared
 * via an ADR-002-style capability guard — implementing the interface IS the
 * declaration — never inferred from `platformType`.
 *
 * DELIBERATELY NOT bound to a single base port, unlike every other capability
 * in this repo (`OfflineResubmitter` narrows `InvoicingPort`,
 * `TaxonomyIdentityProvider` narrows `OfferManagerPort`, …). Self-routing is a
 * fact about a document-ISSUING destination in general — today that means
 * `InvoicingPort` or `FiscalizationPort`, ADR-041's two peer document
 * contexts — and `sales-documents` is the one concern the ADR places above
 * both precisely so neither has to know the other exists (decision 1). Binding
 * this guard to either port's type would make `sales-documents` value-import
 * `InvoicingPort` or `FiscalizationPort`, closing exactly the runtime-dependency
 * -free-leaf property `barrel-purity.spec.ts` pins (only one authorized
 * type-only `Order` import is allowed out of this concern). The generic form
 * below needs no import at all: `isSelfRoutingDocumentKind` narrows whatever
 * adapter type the caller already has in hand (an `InvoicingPort`, a
 * `FiscalizationPort`, or a future third document-issuing port), the same way
 * `dispatchCapability`'s open-world design keeps a capability name from
 * requiring a closed adapter union.
 *
 * No adapter in this repo implements it yet (#2158 ships the mechanism, not a
 * first consumer) — `resolveSalesDocumentRouting`'s spec exercises it via a
 * fake candidate rather than a real adapter.
 *
 * @module libs/core/src/sales-documents/domain/ports/capabilities
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */

export interface SelfRoutingDocumentKind {
  /**
   * Presence of this method is the declaration (ADR-041 decision 9) — its
   * return value carries no information beyond confirming the adapter
   * implements the capability. An adapter that self-routes always returns
   * the literal `true`.
   */
  selfRoutesDocumentKind(): true;
}

export function isSelfRoutingDocumentKind<T extends object>(
  adapter: T,
): adapter is T & SelfRoutingDocumentKind {
  return typeof (adapter as Partial<SelfRoutingDocumentKind>).selfRoutesDocumentKind === 'function';
}
