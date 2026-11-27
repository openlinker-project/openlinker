/**
 * Bulk Row Result Helpers (#3545)
 *
 * The two things every per-row bulk action on the orders list repeats: collapsing
 * a repeated id to one outcome, and turning an UNEXPECTED throw into a PII-free
 * reason. Follows `POST /invoices/bulk-issue` (#1355): sequential, never
 * all-or-nothing, nothing raw from a provider or the database reaches the response.
 *
 * @module apps/api/src/orders/http
 */
import { randomUUID } from 'crypto';
import type { Logger } from '@openlinker/shared/logging';

/** Max order ids per bulk request; bounds the synchronous fan-out. */
export const BULK_ORDER_ACTION_MAX = 100;

/** De-duplicate preserving first-seen order, so one id gets exactly one outcome. */
export function dedupeOrderIds(orderIds: readonly string[]): string[] {
  return [...new Set(orderIds)];
}

/**
 * The reason string for a row whose action threw something the endpoint does not
 * model. The raw message is logged with a correlation id and never returned.
 */
export function unexpectedRowFailure(
  logger: Logger,
  action: string,
  orderId: string,
  error: unknown
): string {
  const correlationId = randomUUID();
  logger.error(
    `Bulk ${action} failed for ${orderId} (correlationId: ${correlationId}): ${(error as Error).message}`,
    (error as Error).stack
  );
  return `Unexpected error (correlationId: ${correlationId}).`;
}
