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

/**
 * Read from `publicConfig`, the adapter-declared role-safe projection of the
 * config (the adapter lists the key in its manifest `publicConfigKeys`). The raw
 * `config` is `{}` for every non-admin role, so reading it here would show an
 * operator the "recording only" copy on an opted-in connection. No platform
 * branch: an adapter that does not declare the key simply reads false.
 */
export function useRefundSentToShopify(sourceConnectionId: string | null | undefined): boolean {
  const query = useConnectionQuery(sourceConnectionId ?? '');
  return query.data?.publicConfig?.refundsThroughShopify === true;
}
