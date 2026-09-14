/**
 * Sales-Document Destination Warnings (#3178)
 *
 * A rule names a `connectionId` as its destination, but nothing stopped an
 * operator saving a rule that points at a connection that cannot be a
 * routing candidate at all. `AutoIssueTriggerService` lists ACTIVE
 * connections carrying `Invoicing` or `Fiscalization` and only then reduces
 * them to candidates (`docs/architecture-overview.md § 14. Invoicing`), so a
 * rule naming a connection that fails EITHER half can never route: it saves
 * happily and is discovered only when an order goes unexpectedly held.
 *
 * The predicate therefore mirrors both halves of that gate, matching the
 * `status === 'active' && documentKind !== null` reading
 * `detectSalesDocumentConflict` and the country-default candidate list
 * already use — `deriveSalesDocumentRows` deliberately does NOT filter on
 * status, so testing its output alone would leave a disabled connection with
 * a configured role silently unwarned, the one false-negative direction that
 * matters here.
 *
 * The two failures are reported as DIFFERENT reasons because they have
 * different remedies: a role-less connection needs a role, a non-active one
 * needs enabling or reconnecting. Status wins when a connection fails both,
 * mirroring the runtime order — a connection that is not active cannot route
 * whatever its role says.
 *
 * This is a display-only mirror, the same posture as
 * `detectSalesDocumentConflict` — it surfaces the fact, it does not enforce
 * anything and it resolves no adapter. A connection with neither `Invoicing`
 * nor `Fiscalization` enabled produces no row at all in
 * `deriveSalesDocumentRows`; that absence is folded into the SAME
 * "issues nothing" reading rather than treated as a different case, since
 * such a connection is equally unable to issue anything.
 *
 * Mockup reconciliation (`docs/plans/mockups/sales-document-rule-composer.html`,
 * `rules-destination-warning`): the mockup panel draws the single
 * `issues-nothing` destination only. Its sentence was updated alongside this
 * change; the `not-active` and `unknown-connection` sentences and the plural
 * title are implementation states that one panel does not enumerate.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { Connection, ConnectionStatus } from '../../connections';
import type { SalesDocumentRule } from '../api/sales-document-rules.types';
import type { SalesDocumentRow } from '../api/sales-documents.types';
import { deriveSalesDocumentRows } from './derive-sales-document-rows';

type InactiveConnectionStatus = Exclude<ConnectionStatus, 'active'>;

interface SalesDocumentDestinationWarningBase {
  connectionId: string;
  /** The connection's own name, or the raw id when it is not in the list. */
  connectionName: string;
  /** How many of the SUPPLIED `rules` name this connection — never a global count. */
  affectedRuleCount: number;
}

export type SalesDocumentDestinationWarning =
  | (SalesDocumentDestinationWarningBase & { reason: 'issues-nothing' })
  | (SalesDocumentDestinationWarningBase & {
      reason: 'not-active';
      status: InactiveConnectionStatus;
    })
  | (SalesDocumentDestinationWarningBase & { reason: 'unknown-connection' });

/** Derived from the union so the two cannot drift apart. */
export type SalesDocumentDestinationWarningReason = SalesDocumentDestinationWarning['reason'];

/**
 * A rule whose window has closed cannot route whatever its destination does,
 * so warning about it is noise on a market whose history is intact. A rule
 * that has not STARTED yet is still warned about — it will route soon and the
 * operator can fix the destination now.
 */
function hasExpired(rule: SalesDocumentRule, now: Date): boolean {
  if (rule.effectiveTo === null) return false;
  const endsAt = Date.parse(rule.effectiveTo);
  // An unparseable window is never read as expired: suppressing the warning
  // is the failure direction that lets a dead destination through unseen.
  return Number.isFinite(endsAt) && endsAt <= now.getTime();
}

/**
 * `null` = this destination can route. Reason and warning are resolved in one
 * pass so the `not-active` status is narrowed by the guard rather than cast.
 */
function resolveWarning(
  connectionId: string,
  connection: Connection | undefined,
  row: SalesDocumentRow | undefined,
): SalesDocumentDestinationWarning | null {
  // Unreachable through the API — `sales_document_rules.connection_id` is a
  // FOREIGN KEY … ON DELETE CASCADE, so a rule cannot outlive its connection.
  // Kept because the two queries are cached independently: a connections list
  // fetched before a connection existed still renders that connection's rules.
  if (connection === undefined) {
    return {
      connectionId,
      connectionName: connectionId,
      affectedRuleCount: 1,
      reason: 'unknown-connection',
    };
  }

  const base = { connectionId, connectionName: connection.name, affectedRuleCount: 1 };
  if (connection.status !== 'active') {
    return { ...base, reason: 'not-active', status: connection.status };
  }
  // `row === undefined` folds "no row at all" (no Invoicing/Fiscalization
  // capability enabled, so `deriveSalesDocumentRows` never produced one) into
  // the same "issues nothing" reading a `documentKind: null` row gets.
  if ((row?.documentKind ?? null) === null) {
    return { ...base, reason: 'issues-nothing' };
  }
  return null;
}

/**
 * One warning per DISTINCT offending connection, in the order its first
 * offending rule appears in `rules` — never one per rule, so a market with
 * five rules naming the same dead connection renders one alert, not five.
 */
export function findSalesDocumentDestinationWarnings(
  rules: readonly SalesDocumentRule[],
  connections: readonly Connection[],
  now: Date = new Date(),
): SalesDocumentDestinationWarning[] {
  const rowByConnectionId = new Map(
    deriveSalesDocumentRows(connections).map((row) => [row.connectionId, row]),
  );
  const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
  const warningsByConnectionId = new Map<string, SalesDocumentDestinationWarning>();

  for (const rule of rules) {
    if (hasExpired(rule, now)) continue;

    const existing = warningsByConnectionId.get(rule.connectionId);
    if (existing) {
      existing.affectedRuleCount += 1;
      continue;
    }

    const warning = resolveWarning(
      rule.connectionId,
      connectionById.get(rule.connectionId),
      rowByConnectionId.get(rule.connectionId),
    );
    if (warning === null) continue;

    warningsByConnectionId.set(rule.connectionId, warning);
  }

  return [...warningsByConnectionId.values()];
}

export function describeSalesDocumentDestinationWarningTitle(count: number): string {
  return count === 1
    ? 'One destination is not issuing anything'
    : `${count} destinations are not issuing anything`;
}

const INACTIVE_STATUS_COPY: Record<InactiveConnectionStatus, { state: string; remedy: string }> = {
  disabled: { state: 'is disabled', remedy: 'Enable it' },
  needs_reauth: { state: 'needs reconnecting', remedy: 'Reconnect it' },
  error: { state: 'is in an error state', remedy: 'Fix the connection' },
};

export function describeSalesDocumentDestinationWarning(
  warning: SalesDocumentDestinationWarning,
): string {
  const ruleText =
    warning.affectedRuleCount === 1 ? 'the rule naming it' : `${warning.affectedRuleCount} rules naming it`;
  const pronoun = warning.affectedRuleCount === 1 ? 'it' : 'them';

  switch (warning.reason) {
    case 'issues-nothing':
      return `${warning.connectionName} is set to issue Nothing under Connected providers, so ${ruleText} cannot route. Give it a role, or point ${pronoun} elsewhere.`;
    case 'not-active': {
      const { state, remedy } = INACTIVE_STATUS_COPY[warning.status];
      return `${warning.connectionName} ${state}, so ${ruleText} cannot route — auto-issuance only ever considers active connections. ${remedy}, or point ${pronoun} elsewhere.`;
    }
    case 'unknown-connection':
      return `${warning.connectionId} is not in your connections list, so ${ruleText} cannot route. Refresh the page — if it stays, point ${pronoun} at a live provider.`;
  }
}
