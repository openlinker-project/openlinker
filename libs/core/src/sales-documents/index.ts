/**
 * Sales Documents - public barrel (#2100, #2155, #2158, #2170, #2245, #2248/#2252)
 *
 * ADR-041 decision 1 ("module now, context later"): this concern owns the
 * neutral reason vocabularies both the invoicing gate and the routing
 * decision speak (#2100), the routing decision itself — `SalesDocumentKind`,
 * `SalesDocumentDecision`, and the two pure resolvers,
 * `resolveSalesDocumentRouting` (#2155, `operator-configured` mode) and
 * `evaluateSalesDocumentRules` (#2170, the country-agnostic rule engine
 * ADR-041 decision 5 originally deferred) — and the self-routing capability
 * guard, `SelfRoutingDocumentKind` / `isSelfRoutingDocumentKind` (#2158, ADR-041
 * decision 9).
 *
 * **The concern is no longer NestJS-free (#2170), but it is STILL a
 * zero-outbound-CORE-CONTEXT-edge leaf.** Those are two different properties:
 * "no framework dependency" and "no sibling-bounded-context dependency". The
 * rule engine's own persistence (`SalesDocumentsModule` + its repositories)
 * needed the first to give up — the write-path conflict guard genuinely
 * needs a database — but nothing in this concern injects `IIntegrationsService`,
 * `IOrdersService`, or any other `@openlinker/core/<sibling>` token; the one
 * connection-capability check the mockup describes ("a rule pointing
 * `Invoice → eparagony.pl` is rejected because eparagony.pl carries no
 * `Invoicing` capability") is deliberately done at the API layer
 * (`apps/api/src/sales-documents/`), which already has that token in scope,
 * rather than injected here. `libs/core/src/__tests__/barrel-purity.spec.ts`
 * now enforces the NARROWER property: no VALUE or (non-exempt) TYPE-ONLY
 * import from a `@openlinker/core/<ctx>` specifier anywhere under this
 * directory, while `@nestjs/*` / `typeorm` / `node:crypto` imports are
 * unrestricted. The one authorized cross-context TYPE-only exception from
 * before (`Order`, from the `@openlinker/core/orders/types` cycle-breaker
 * sub-barrel — ADR-041 decision 2) still applies unchanged, and still only to
 * `resolveSalesDocumentRouting`. The capability guard is generic rather than
 * bound to a single base port for exactly the same dependency-discipline
 * reason (see its own doc comment).
 *
 * Two further vocabularies live here for the same reason the reason unions do -
 * BOTH document contexts need one answer and a fiscal receipt is not an
 * invoice. `shipping-tax-split.types` is the proportional split of a shipping
 * charge across the rates in a mixed-rate basket (#2248 / #2252, ADR-063 § 5),
 * and `tax-rate-enforcement.types` is the per-line tax-rate enforcement switch
 * plus the pre-rollout era marker (#2245, ADR-063 § Consequences). Both are
 * import-free, so any context or channel adapter can value-import them.
 *
 * @module libs/core/src/sales-documents
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
export * from './domain/types/sales-document-reason.types';
export * from './domain/types/sales-document-kind.types';
export * from './domain/types/sales-document-decision.types';
export * from './domain/types/sales-document-condition.types';
export * from './domain/types/sales-document-order-facts.types';
export * from './domain/types/sales-document-rule-write.types';
export * from './domain/types/sales-document-country-summary.types';
export * from './domain/types/sales-document-market-discovery.types';
export * from './domain/types/sales-document-view.types';
export * from './domain/ports/capabilities/self-routing-document-kind.capability';
export * from './domain/domain-services/resolve-sales-document-routing';
export * from './domain/domain-services/evaluate-sales-document-rules';
export * from './domain/domain-services/choose-sales-document-decision';
export { SalesDocumentRule } from './domain/entities/sales-document-rule.entity';
export { SalesDocumentCountryDefault } from './domain/entities/sales-document-country-default.entity';
export { SalesDocumentThreshold } from './domain/entities/sales-document-threshold.entity';
export { SalesDocumentCountryAcknowledgment } from './domain/entities/sales-document-country-acknowledgment.entity';
export { SalesDocumentRuleConflictException } from './domain/exceptions/sales-document-rule-conflict.exception';
export { SalesDocumentThresholdNotFoundException } from './domain/exceptions/sales-document-threshold-not-found.exception';
export { SalesDocumentInvalidConditionException } from './domain/exceptions/sales-document-invalid-condition.exception';
export { SalesDocumentCountryAlreadyConfiguredException } from './domain/exceptions/sales-document-country-already-configured.exception';
export {
  SalesDocumentRuleNotFoundException,
  SalesDocumentCountryDefaultNotFoundException,
} from './domain/exceptions/sales-document-rule-not-found.exception';
export type { ISalesDocumentRulesService } from './application/interfaces/sales-document-rules.service.interface';
export { SalesDocumentsModule } from './sales-documents.module';
export * from './sales-documents.tokens';
// Proportional shipping split across the rates in a mixed-rate basket (#2248 /
// #2252). Lives here because BOTH document contexts consume it and a fiscal
// receipt is not an invoice - the same reason the reason vocabularies do.
export * from './domain/types/shipping-tax-split.types';
// The per-line tax-rate enforcement switch and the pre-rollout era marker
// (#2245 review, ADR-063 § Consequences). Here for the same reason the shipping
// split is: both document contexts and both channel adapters need one answer,
// and this leaf imports nothing so any of them can value-import it.
export * from './domain/types/tax-rate-enforcement.types';
// The readable in-flight signal (#2521, ADR-042 amendment #2502 decision 2).
// Here for the same reason the two vocabularies above are: a per-order surface
// covering both kinds must not branch on which context answered, and a fiscal
// receipt is not an invoice, so neither context could own the shape for the
// other. Visibility only - it changes no lease and no guarantee.
export * from './domain/types/sales-document-in-flight.types';
// Whether an order's LINE prices are gross-eligible for document issuance
// (#2835). Here for the same reason the vocabularies above are: both document
// contexts refuse a net-priced order identically, and this leaf imports
// nothing so both can value-import it without either owning the other's
// wording.
export * from './domain/types/gross-price-eligibility.types';
