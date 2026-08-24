/**
 * Sales-Document Rule Domain Entity (#2170, ADR-041 decision 5, narrowed)
 *
 * One operator-authored `conditions → documentKind → connectionId` mapping,
 * scoped to a country (ISO 3166-1 alpha-2) or the `*` "Rest of world"
 * pseudo-country. Anemic per ADR-011 — readonly fields, no behaviour;
 * `conditionsHash` is a stored derived value (computed by the application
 * service via `computeSalesDocumentConditionsHash`), not recomputed here.
 *
 * `provenance` is the quiet, informational "from: PL starter template" audit
 * tag (mockup tab 02) stamped on a rule created by adopting a starter
 * template — `null` for an ordinary operator-authored rule. It carries no
 * enforcement: an adopted rule is fully editable/deletable like any other row.
 *
 * @module libs/core/src/sales-documents/domain/entities
 */
import type { SalesDocumentCondition } from '../types/sales-document-condition.types';

export class SalesDocumentRule {
  constructor(
    public readonly id: string,
    public readonly country: string,
    public readonly conditions: readonly SalesDocumentCondition[],
    public readonly conditionsHash: string,
    public readonly documentKind: string,
    public readonly connectionId: string,
    public readonly effectiveFrom: Date,
    public readonly effectiveTo: Date | null,
    public readonly provenance: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
