/**
 * Sales-Document Connection Role Gap (#3232)
 *
 * Four surfaces answer "which connection may a routing decision name" —
 * `find-sales-document-destination-warnings.ts` (#3209),
 * `sales-document-country-defaults.tsx` (#3210),
 * `sales-document-rule-composer-dialog.tsx`, and
 * `sales-document-template-screen.tsx`. The first two require BOTH a
 * capability (`Invoicing` / `Fiscalization` enabled) AND a role
 * (`config.salesDocument.documentKind` set under Connected providers) —
 * `status === 'active' && documentKind !== null`. The last two require only
 * the capability, via `selectInvoicingCandidates` / `selectFiscalizationCandidates`.
 *
 * THAT DIVERGENCE IS DELIBERATE, not a residual gap left over from #3209 /
 * #3210 — a rule (and a template's rule) carries its OWN `documentKind`,
 * chosen explicitly by the operator in the dialog/screen, so nothing about
 * DISPATCHING it reads the connection's role at all:
 * `AutoIssueTriggerService.dispatchRoute` resolves the winning connection
 * from the plain active + capability-enabled connection list, never from the
 * role-filtered `SalesDocumentRoutingCandidate` pool that role feeds. That
 * pool is consulted only by the pre-#2170 zero-configuration fallback
 * (`resolveSalesDocumentRouting`), reached only when the rule engine reports
 * `'no-configuration-for-country'` — see `chooseSalesDocumentDecision`
 * (`libs/core/src/sales-documents/domain/domain-services/choose-sales-document-decision.ts`).
 * A country that HAS a matching rule never consults the role at all. Requiring
 * one here would refuse a rule that routes perfectly well, and would block the
 * "assign a role and a rule in one pass" workflow this issue's own
 * proposed-solution text names as the reason a wider set is legitimate.
 *
 * The role's remaining purpose is narrower than "can this rule route": the
 * country-default picker needs SOME source for `documentKind` because the
 * operator does not choose one there (`sales-document-country-defaults.tsx`'s
 * own doc comment), and the destination-warnings / conflict displays both
 * treat a role-less connection as "not a candidate" for THEIR different
 * questions (the pre-#2170 fallback's own eligibility, which a role-less
 * connection cannot satisfy). So picking a role-less-but-capable connection
 * here is not silently wrong — but it IS something the operator should know,
 * or they discover it only later, as a "cannot route" alert on the very rule
 * they just saved (the contradiction #3232 was filed to remove). This module
 * is what keeps that fact visible at PICK TIME instead of only afterwards.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { Connection } from '../../connections';
import type { SalesDocumentRow } from '../api/sales-documents.types';
import { deriveSalesDocumentRows } from './derive-sales-document-rows';

/**
 * Same answer as {@link findSalesDocumentConnectionRoleGap}, but takes an
 * already-derived `rows` list instead of deriving one internally. A caller
 * checking a gap for several connections in one render (e.g. one per
 * template slot) should derive `rows` once and call this variant per
 * connection, rather than re-deriving the whole list on every call.
 */
export function findSalesDocumentConnectionRoleGapFromRows(
  connectionId: string,
  connections: readonly Connection[],
  rows: readonly SalesDocumentRow[],
): string | null {
  if (connectionId === '') return null;

  const connection = connections.find((c) => c.id === connectionId);
  if (connection === undefined) return null;

  // Reuses `deriveSalesDocumentRows`'s own config coercion rather than
  // re-reading `connection.config.salesDocument.documentKind` inline, so a
  // change to that coercion cannot make this helper and the country-default
  // picker / destination-warnings list disagree about the same connection.
  const row = rows.find((r) => r.connectionId === connectionId);
  if ((row?.documentKind ?? null) !== null) return null;

  return connection.name;
}

/**
 * `null` when `connectionId` is empty, names a connection this list does not
 * know about, or already carries a role. Otherwise the connection's display
 * name, to be named in the pick-time warning.
 *
 * Derives `deriveSalesDocumentRows(connections)` internally on every call —
 * fine for a single pick-time check per render, but a caller checking a gap
 * for several connections (e.g. once per row inside a `.map()`) should use
 * {@link findSalesDocumentConnectionRoleGapFromRows} with a hoisted `rows`
 * instead, to avoid re-deriving the whole connection list per row.
 */
export function findSalesDocumentConnectionRoleGap(
  connectionId: string,
  connections: readonly Connection[],
): string | null {
  return findSalesDocumentConnectionRoleGapFromRows(
    connectionId,
    connections,
    deriveSalesDocumentRows(connections),
  );
}

/** The pick-time warning sentence for a connection {@link findSalesDocumentConnectionRoleGap} named. */
export function describeSalesDocumentConnectionRoleGap(connectionName: string): string {
  return (
    `${connectionName} has no role set under Connected providers yet. This rule will still ` +
    `route on its own, but ${connectionName} will show up on the destination-warnings list ` +
    `here until it has one.`
  );
}
