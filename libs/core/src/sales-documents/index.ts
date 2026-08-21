/**
 * Sales Documents — public barrel (#2100)
 *
 * ADR-041 decision 1 ("module now, context later"): this concern exists today
 * only to own the neutral reason vocabularies that both the invoicing gate and a
 * future routing decision speak. It carries no NestJS module, no service and no
 * persistence — deliberately, so it stays a dependency-free leaf every context
 * can value-import without closing a module-load cycle. That property is pinned
 * by `libs/core/src/__tests__/barrel-purity.spec.ts`, which fails on any import
 * statement added anywhere under this directory.
 *
 * **No `sales-documents.tokens.ts`, and that is the documented exception** to
 * `docs/engineering-standards.md § Symbol DI Token Re-export Convention` rule 1.
 * The rule exists so a context's DI bindings are discoverable from one file; this
 * concern has no bindings to discover — no service, no repository, no port — so an
 * empty tokens file would be pure ceremony, and `export *` from it would widen the
 * barrel with nothing. The exception ends the moment a token is needed: add the
 * file then, and the sub-barrel line with it.
 *
 * The routing decision type (`SalesDocumentDecision`, `SalesDocumentKind`) is
 * #1908-era work and is NOT declared here yet.
 *
 * @module libs/core/src/sales-documents
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
export * from './domain/types/sales-document-reason.types';
// Proportional shipping split across the rates in a mixed-rate basket (#2248 /
// #2252). Lives here because BOTH document contexts consume it and a fiscal
// receipt is not an invoice - the same reason the reason vocabularies do.
export * from './domain/types/shipping-tax-split.types';
