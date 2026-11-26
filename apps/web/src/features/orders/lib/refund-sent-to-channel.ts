/**
 * Where a confirmed refund is sent (#4091 case O25, #4284).
 *
 * An order source is a refund executor only when its connection opted in:
 * Shopify with `config.refundsThroughShopify: true`, a Mirakl marketplace (Empik)
 * with `config.refundsThroughMarketplace: true`. Otherwise a confirmed refund is
 * just recorded. The copy must follow that, because "OpenLinker does not move
 * money" is false on an opted-in connection and "OpenLinker sends it" is false on
 * every other one. Anything unreadable falls back to the recording-only wording.
 *
 * @module apps/web/src/features/orders/lib
 */
import { useConnectionQuery } from '../../connections';

/**
 * The opt-in keys adapters declare in their manifest `publicConfigKeys`. A key
 * names the adapter's own setting, so the list grows when another adapter adds
 * a refund executor; an adapter that declares none simply reads as not opted in.
 */
const REFUND_OPT_IN_KEYS = ['refundsThroughShopify', 'refundsThroughMarketplace'] as const;

/**
 * The connection's name when a confirmed refund is sent through it, else `null`.
 *
 * Read from `publicConfig`, the adapter-declared role-safe projection of the
 * config. The raw `config` is `{}` for every non-admin role, so reading it here
 * would show an operator the "recording only" copy on an opted-in connection.
 */
export function useRefundSentToChannel(sourceConnectionId: string | null | undefined): string | null {
  const query = useConnectionQuery(sourceConnectionId ?? '');
  const connection = query.data;
  if (!connection) {
    return null;
  }
  const optedIn = REFUND_OPT_IN_KEYS.some((key) => connection.publicConfig?.[key] === true);
  return optedIn ? connection.name : null;
}
