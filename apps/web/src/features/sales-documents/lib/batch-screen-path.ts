/**
 * Batch screen path (#3584)
 *
 * One spelling of the batch-issuing screen's URL for the route and every link
 * to it.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
export const BATCH_SCREEN_ROUTE_PATH = 'settings/sales-documents/batches/:connectionId';

export function batchScreenPath(connectionId: string): string {
  return `/settings/sales-documents/batches/${encodeURIComponent(connectionId)}`;
}
