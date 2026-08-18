/**
 * Sales-Document Country Default Domain Entity (#2170, ADR-041 decision 5)
 *
 * Tier 2 of the fallback ladder: the connection a country falls back to for
 * one document kind when no rule matches. Unique together on
 * `(country, documentKind)` — "the default" is structurally singular, never a
 * list a reader has to pick from. Anemic per ADR-011.
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
