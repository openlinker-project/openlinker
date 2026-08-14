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
import type { InvoiceRecord } from '../api/invoicing.types';

const INVOICING_CAPABILITY = 'Invoicing';

/**
 * The connection fields these helpers actually read — a STRUCTURAL type, not the
 * `connections` feature's `Connection`.
 *
 * Declared locally so this module needs no `features/invoicing` →
 * `features/connections` import: the frontend's dependency rule is
 * `app → pages → features → shared`, which says nothing about sibling features,
 * and a cross-feature type import is the kind of edge that quietly becomes a
 * cycle. `Connection` structurally satisfies it, so callers pass one unchanged.
 *
 * Every helper that hands a connection BACK is generic over `T extends
 * InvoicingConnectionLike`, so the caller gets its own concrete type back (the
 * panel still reads `connection.name` off a real `Connection`) — narrowing the
 * input contract costs the caller no fidelity on the way out.
 */
export interface InvoicingConnectionLike {
  id: string;
  status: string;
  enabledCapabilities: readonly string[];
  supportedCapabilities: readonly string[];
  config: Record<string, unknown>;
}

/**
 * Is this connection the operator-designated primary
 * (`config.invoicing.isPrimary`)? Mirrors the backend's
 * `parseIsPrimaryInvoicing` coercion: only a real `true` (or the string
 * `'true'`, how a hand-edited JSON config arrives) counts. The backend is
 * authoritative — this read only drives preselection and the "primary" label.
 */
export function isPrimaryInvoicingConnection(connection: InvoicingConnectionLike): boolean {
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
export function selectInvoicingCandidates<T extends InvoicingConnectionLike>(
  connections: readonly T[],
): T[] {
  return connections
    .filter((c) => c.status === 'active' && c.enabledCapabilities.includes(INVOICING_CAPABILITY))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Connections that cannot issue right now but could after a reconnect —
 * `needs_reauth` / `error` with `Invoicing` in their supported capabilities.
 */
export function selectReauthInvoicingConnections<T extends InvoicingConnectionLike>(
  connections: readonly T[],
): T[] {
  return connections.filter(
    (c) =>
      (c.status === 'needs_reauth' || c.status === 'error') &&
      c.supportedCapabilities.includes(INVOICING_CAPABILITY),
  );
}

/** The connection an existing invoice is locked to, and whether it is still usable. */
export interface IssuingConnectionResolution<T extends InvoicingConnectionLike> {
  /** The full connection when OL still knows it; `null` when it was deleted. */
  connection: T | null;
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
export function resolveIssuingConnection<T extends InvoicingConnectionLike>(
  invoice: InvoiceRecord,
  connections: readonly T[],
): IssuingConnectionResolution<T> {
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
export function resolveIssuableConnection<T extends InvoicingConnectionLike>(
  candidates: readonly T[],
  pickedConnectionId: string | null,
): T | null {
  if (pickedConnectionId !== null) {
    return candidates.find((c) => c.id === pickedConnectionId) ?? null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  return candidates.find((c) => isPrimaryInvoicingConnection(c)) ?? null;
}
