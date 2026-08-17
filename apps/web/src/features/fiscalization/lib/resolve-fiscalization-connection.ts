/**
 * Fiscalization connection resolution (#1909)
 *
 * Pure helper answering "which connections could register a receipt for this
 * order?" — mirrors `resolve-invoicing-connection.ts`'s candidate filter, minus
 * the primary/lock machinery invoicing needs: v1 has no auto-issue and no
 * one-per-order write path to lock (ADR-042: registration happens only on an
 * explicit operator request), so a record never removes the picker the way an
 * invoice does.
 *
 * @module apps/web/src/features/fiscalization/lib
 */

const FISCALIZATION_CAPABILITY = 'Fiscalization';

/** Structural type — same rationale as `InvoicingConnectionLike`: no
 *  cross-feature import from `features/connections`. */
export interface FiscalizationConnectionLike {
  id: string;
  status: string;
  enabledCapabilities: readonly string[];
}

export function selectFiscalizationCandidates<T extends FiscalizationConnectionLike>(
  connections: readonly T[],
): T[] {
  return connections
    .filter((c) => c.status === 'active' && c.enabledCapabilities.includes(FISCALIZATION_CAPABILITY))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}
