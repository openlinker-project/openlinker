/**
 * Order import verdict
 *
 * One answer to "is order import fine?" for the Orders tab (#4228), derived from
 * the facts the backend can prove: whether the figures could be read at all, whether
 * orders are failing, whether the job queue is backed up and when the shop was last
 * polled successfully. Pure, so the
 * rule is testable without rendering.
 *
 * The thresholds are statements about what an operator should worry about, not
 * about the poll cadence (which differs per source): a shop not polled for an hour
 * is behind on every source this product ships.
 *
 * @module features/connections/lib
 */
import type { OrderImportStatus } from '../api/connections.types';

export const ORDER_IMPORT_BEHIND_AFTER_MS = 60 * 60 * 1000;

export type OrderImportVerdict = 'ok' | 'behind' | 'failing' | 'notChecked' | 'unknown';

export function deriveOrderImportVerdict(
  orderImport: OrderImportStatus | null,
  now: Date = new Date(),
  queueStatus?: string,
): OrderImportVerdict {
  if (orderImport === null) return 'unknown';
  if (orderImport.failedLast7d > 0) return 'failing';
  // A backed-up queue means checked orders are not being worked off, whatever the last poll says.
  if (queueStatus === 'backlogged') return 'behind';
  if (orderImport.lastPolledAt === null) return 'notChecked';
  const age = now.getTime() - new Date(orderImport.lastPolledAt).getTime();
  return age > ORDER_IMPORT_BEHIND_AFTER_MS ? 'behind' : 'ok';
}
