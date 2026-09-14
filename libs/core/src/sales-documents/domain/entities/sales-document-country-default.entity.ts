/**
 * Sales-Document Country Default Domain Entity (#2170, ADR-041 decision 5, #3177)
 *
 * Tier 2 of the fallback ladder: the ONE connection a country falls back to
 * when no rule matches. Unique on `country` ALONE (#3177) — "the default" is
 * structurally singular, never a list a reader has to pick from, and never
 * one-per-`documentKind` either: a country carrying both an invoice default
 * and a receipt default at once disabled the fallback step entirely
 * (`evaluateSalesDocumentRules` reads `ambiguous-defaults` -> `unresolved`),
 * so at most one row per country can only ever fix behaviour. `documentKind`
 * stays on the row because a document still needs a kind to route to — it is
 * simply no longer part of what makes the row unique. Anemic per ADR-011.
 *
 * @module libs/core/src/sales-documents/domain/entities
 */
export class SalesDocumentCountryDefault {
  constructor(
    public readonly id: string,
    public readonly country: string,
    public readonly documentKind: string,
    public readonly connectionId: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
