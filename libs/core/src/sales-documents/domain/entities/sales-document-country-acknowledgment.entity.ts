/**
 * Sales-Document Country Acknowledgment Domain Entity (#2186)
 *
 * Persists "this market intentionally has no sales document configured" as
 * a distinct fact from "nobody has configured it yet" — before this entity
 * both read identically (an empty rule/default set for the country). The
 * acknowledgment is INFORMATIONAL only: it never changes what
 * `resolveSalesDocumentRouting` returns for an order in that country (still
 * `unresolved` / `no-configuration-for-country`, identically whether
 * acknowledged or merely empty) — making it behavioral is an explicit
 * non-goal (#2186 issue, § Assumptions).
 *
 * Keyed by `country` alone (no surrogate id) — mirrors
 * `SalesDocumentThreshold`'s `ref`-as-primary-key shape, since "the
 * acknowledgment for this country" is structurally singular. Anemic per
 * ADR-011.
 *
 * @module libs/core/src/sales-documents/domain/entities
 */
export class SalesDocumentCountryAcknowledgment {
  constructor(
    public readonly country: string,
    public readonly acknowledgedAt: Date,
  ) {}
}
