/**
 * Invoicing connection resolution (#2047)
 *
 * Pure helpers that answer "which connection does this order's invoice belong
 * to, and may the operator still choose one?" — the frontend half of the
 * one-invoice-per-order rule.
 *
 * The rule in one line: once a record exists, the connection is a FACT read off
 * `invoice.connectionId`; only an order with no record at all leaves a CHOICE.
 * Before #2047 the panel resolved the connection from an operator pick, so
 * switching the picker on an invoiced order asked "is there an invoice on THIS
 * connection?", got a 404, rendered "not issued", and offered to issue a second
 * document for one sale.
 *
 * @module apps/web/src/features/invoicing/lib
 */
import type { Connection } from '../../connections';
import type { InvoiceRecord } from '../api/invoicing.types';

const INVOICING_CAPABILITY = 'Invoicing';

/**
 * Is this connection the operator-designated primary
 * (`config.invoicing.isPrimary`)? Mirrors the backend's
 * `parseIsPrimaryInvoicing` coercion: only a real `true` (or the string
 * `'true'`, how a hand-edited JSON config arrives) counts. The backend is
 * authoritative — this read only drives preselection and the "primary" label.
 */
export function isPrimaryInvoicingConnection(connection: Connection): boolean {
  const invoicing = connection.config['invoicing'];
  if (invoicing === null || typeof invoicing !== 'object') {
    return false;
  }
  const flag = (invoicing as Record<string, unknown>)['isPrimary'];
  return flag === true || flag === 'true';
}

/**
 * Connections that could issue an invoice right now: active + `Invoicing`
 * enabled, sorted by id so the order is deterministic across renders.
 */
export function selectInvoicingCandidates(connections: readonly Connection[]): Connection[] {
  return connections
    .filter((c) => c.status === 'active' && c.enabledCapabilities.includes(INVOICING_CAPABILITY))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Connections that cannot issue right now but could after a reconnect —
 * `needs_reauth` / `error` with `Invoicing` in their supported capabilities.
 */
export function selectReauthInvoicingConnections(
  connections: readonly Connection[],
): Connection[] {
  return connections.filter(
    (c) =>
      (c.status === 'needs_reauth' || c.status === 'error') &&
      c.supportedCapabilities.includes(INVOICING_CAPABILITY),
  );
}

/** The connection an existing invoice is locked to, and whether it is still usable. */
export interface IssuingConnectionResolution {
  /** The full connection when OL still knows it; `null` when it was deleted. */
  connection: Connection | null;
  /**
   * The record's `connectionId` — always present, so the panel can name the
   * connection by id when the connection itself is gone.
   */
  connectionId: string;
  /**
   * True when the connection can no longer act: deleted, disabled, in error, or
   * no longer carrying the `Invoicing` capability. The invoice still renders (it
   * is an accounting fact) but corrections / resends are unavailable, and no
   * other connection may be offered instead — that would be a second invoice.
   */
  isStale: boolean;
}

/**
 * Resolve the issuing connection from the record, never from an operator pick.
 * Matches against ALL known connections (not just the active candidates) so a
 * disabled or capability-revoked connection is still named rather than shown as
 * a bare id.
 */
export function resolveIssuingConnection(
  invoice: InvoiceRecord,
  connections: readonly Connection[],
): IssuingConnectionResolution {
  const connection = connections.find((c) => c.id === invoice.connectionId) ?? null;
  const isUsable =
    connection !== null &&
    connection.status === 'active' &&
    connection.enabledCapabilities.includes(INVOICING_CAPABILITY);
  return { connection, connectionId: invoice.connectionId, isStale: !isUsable };
}

/**
 * Which connection a NOT-YET-INVOICED order would be issued on: the operator's
 * explicit pick, else the single candidate, else the configured primary. Returns
 * `null` when several candidates exist, none is primary, and nothing was picked
 * — the one state where the panel must ask.
 */
export function resolveIssuableConnection(
  candidates: readonly Connection[],
  pickedConnectionId: string | null,
): Connection | null {
  if (pickedConnectionId !== null) {
    return candidates.find((c) => c.id === pickedConnectionId) ?? null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  return candidates.find((c) => isPrimaryInvoicingConnection(c)) ?? null;
}
