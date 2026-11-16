/**
 * Whether a confirmed refund is sent to the store (#4091, case O25).
 *
 * Shopify's order source is a refund executor only when the connection opted in
 * with `config.refundsThroughShopify: true`; otherwise a confirmed refund is just
 * recorded. The copy must follow that, because "OpenLinker does not move money"
 * is false on an opted-in connection and "OpenLinker sends it" is false on every
 * other one. Anything unreadable falls back to the recording-only wording.
 *
 * @module apps/web/src/features/orders/lib
 */
import { useConnectionQuery } from '../../connections';

export function useRefundSentToShopify(sourceConnectionId: string | null | undefined): boolean {
  const query = useConnectionQuery(sourceConnectionId ?? '');
  const connection = query.data;
  if (!connection || connection.platformType !== 'shopify') return false;
  const config: unknown = connection.config;
  return (
    typeof config === 'object' &&
    config !== null &&
    (config as Record<string, unknown>).refundsThroughShopify === true
  );
}
