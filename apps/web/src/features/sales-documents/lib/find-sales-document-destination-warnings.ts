/**
 * Sales-Document Destination Warnings (#3178)
 *
 * A rule names a `connectionId` as its destination, but nothing stopped an
 * operator saving a rule that points at a connection currently set to issue
 * `Nothing` under Connected providers — the "Issues" column value the
 * centralized table renders when `config.salesDocument.documentKind` is
 * unset (`deriveSalesDocumentRows`, #2159). Such a connection is, in the
 * provider table's own words, not a routing candidate at all
 * (`AutoIssueTriggerService` never lists it as a candidate — see
 * `docs/architecture-overview.md § 14. Invoicing`), so every rule naming it
 * can never route: it saves happily and is discovered only when an order
 * goes unexpectedly held.
 *
 * This is a display-only mirror, the same posture as
 * `detectSalesDocumentConflict` — it surfaces the fact, it does not enforce
 * anything and it resolves no adapter. A connection with neither `Invoicing`
 * nor `Fiscalization` enabled produces no row at all in
 * `deriveSalesDocumentRows`; that absence is folded into the SAME warning
 * rather than treated as a different case, since such a connection is
 * equally unable to issue anything.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { Connection } from '../../connections';
import type { SalesDocumentRule } from '../api/sales-document-rules.types';
import { deriveSalesDocumentRows } from './derive-sales-document-rows';

export interface SalesDocumentDestinationWarning {
  connectionId: string;
  connectionName: string;
  /** How many of the SUPPLIED `rules` name this connection — never a global count. */
  affectedRuleCount: number;
}

/**
 * One warning per DISTINCT offending connection, in the order its first
 * offending rule appears in `rules` — never one per rule, so a market with
 * five rules naming the same dead connection renders one alert, not five.
 */
export function findSalesDocumentDestinationWarnings(
  rules: readonly SalesDocumentRule[],
  connections: readonly Connection[],
): SalesDocumentDestinationWarning[] {
  const documentKindByConnectionId = new Map(
    deriveSalesDocumentRows(connections).map((row) => [row.connectionId, row.documentKind]),
  );
  const warningsByConnectionId = new Map<string, SalesDocumentDestinationWarning>();

  for (const rule of rules) {
    // `?? null` folds "no row at all" (no Invoicing/Fiscalization capability
    // enabled, so `deriveSalesDocumentRows` never produced one) into the
    // same "issues nothing" reading a `documentKind: null` row gets.
    const documentKind = documentKindByConnectionId.get(rule.connectionId) ?? null;
    if (documentKind !== null) continue;

    const existing = warningsByConnectionId.get(rule.connectionId);
    if (existing) {
      existing.affectedRuleCount += 1;
      continue;
    }

    warningsByConnectionId.set(rule.connectionId, {
      connectionId: rule.connectionId,
      connectionName: connections.find((c) => c.id === rule.connectionId)?.name ?? rule.connectionId,
      affectedRuleCount: 1,
    });
  }

  return [...warningsByConnectionId.values()];
}

export function describeSalesDocumentDestinationWarningTitle(count: number): string {
  return count === 1
    ? 'One destination is not issuing anything'
    : `${count} destinations are not issuing anything`;
}

export function describeSalesDocumentDestinationWarning(
  warning: SalesDocumentDestinationWarning,
): string {
  const ruleText =
    warning.affectedRuleCount === 1 ? 'the rule naming it' : `${warning.affectedRuleCount} rules naming it`;
  const pronoun = warning.affectedRuleCount === 1 ? 'it' : 'them';
  return `${warning.connectionName} is set to issue Nothing under Connected providers, so ${ruleText} cannot route. Give it a role, or point ${pronoun} elsewhere.`;
}
