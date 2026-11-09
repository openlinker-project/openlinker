/**
 * Job type label
 *
 * Turns a job type code (`marketplace.orders.poll`) into the operator-facing
 * name from the `sync-jobs` namespace. Read at call time so the label follows
 * the active language. A code with no label - a type added on the server
 * before this bundle knows it - falls back to the raw code rather than to
 * nothing.
 *
 * @module apps/web/src/features/sync-jobs/lib
 */
import { getMessages } from '../../../shared/i18n';

/** `marketplace.orders.poll` -> `marketplaceOrdersPoll`, the key in `sync-jobs.jobTypes`. */
function toLabelKey(jobType: string): string {
  return jobType.replace(/\.([a-zA-Z])/g, (_match, letter: string) => letter.toUpperCase());
}

export function jobTypeLabel(jobType: string): string {
  const labels: Record<string, string | undefined> = getMessages('sync-jobs').jobTypes;
  return labels[toLabelKey(jobType)] ?? jobType;
}
