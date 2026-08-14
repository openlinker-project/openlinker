/**
 * Sales Documents — public barrel (#2100)
 *
 * ADR-041 decision 1 ("module now, context later"): this concern exists today
 * only to own the neutral reason vocabularies that both the invoicing gate and a
 * future routing decision speak. It carries no NestJS module, no service and no
 * persistence — deliberately, so it stays a dependency-free leaf every context
 * can value-import without closing a module-load cycle.
 *
 * The routing decision type (`SalesDocumentDecision`, `SalesDocumentKind`) is
 * #1908-era work and is NOT declared here yet.
 *
 * @module libs/core/src/sales-documents
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
export * from './domain/types/sales-document-reason.types';
