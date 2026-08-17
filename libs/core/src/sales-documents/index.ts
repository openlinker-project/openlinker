/**
 * Sales Documents — public barrel (#2100, #2155)
 *
 * ADR-041 decision 1 ("module now, context later"): this concern owns the
 * neutral reason vocabularies both the invoicing gate and the routing
 * decision speak (#2100), plus the routing decision itself — `SalesDocumentKind`,
 * `SalesDocumentDecision`, and the pure resolver `resolveSalesDocumentRouting`
 * (#2155). It carries no NestJS module, no service and no persistence —
 * deliberately, so it stays a RUNTIME-dependency-free leaf every context can
 * value-import without closing a module-load cycle. That property is pinned
 * by `libs/core/src/__tests__/barrel-purity.spec.ts`, which fails on any
 * VALUE import statement added anywhere under this directory, and on any
 * TYPE-only import that isn't the one authorized exception documented there
 * (`Order`, from the `@openlinker/core/orders/types` cycle-breaker
 * sub-barrel — ADR-041 decision 2).
 *
 * **No `sales-documents.tokens.ts`, and that is the documented exception** to
 * `docs/engineering-standards.md § Symbol DI Token Re-export Convention` rule 1.
 * The rule exists so a context's DI bindings are discoverable from one file; this
 * concern has no bindings to discover — no service, no repository, no port — so an
 * empty tokens file would be pure ceremony, and `export *` from it would widen the
 * barrel with nothing. The exception ends the moment a token is needed: add the
 * file then, and the sub-barrel line with it.
 *
 * @module libs/core/src/sales-documents
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
export * from './domain/types/sales-document-reason.types';
export * from './domain/types/sales-document-kind.types';
export * from './domain/types/sales-document-decision.types';
export * from './domain/domain-services/resolve-sales-document-routing';
