/**
 * Where a confirmed refund is sent, if anywhere (#4091 case O25, #4262).
 *
 * A marketplace's order source is a refund executor only when its connection
 * opted in (Shopify: `config.refundsThroughShopify`, Amazon:
 * `config.refundsEnabled`, Empik: `config.refundsThroughMarketplace`, #4284);
 * otherwise a confirmed refund is just recorded. The
 * copy must follow that, because "OpenLinker does not move money" is false on
 * an opted-in connection and "OpenLinker sends it" is false on every other one.
 * Anything unreadable falls back to the recording-only wording.
 *
 * @module apps/web/src/features/orders/lib
 */
import { useConnectionQuery } from '../../connections';

export const RefundSendTargetValues = ['shopify', 'amazon', 'empik'] as const;
export type RefundSendTarget = (typeof RefundSendTargetValues)[number];

/**
 * The opt-in key each target's adapter lists in its manifest `publicConfigKeys`.
 * Read from `publicConfig`, the role-safe projection of the config: the raw
 * `config` is `{}` for every non-admin role, so reading it here would show an
 * operator the "recording only" copy on an opted-in connection. The key is the
 * adapter's own name, so the platform is the part that picks which key to read.
 */
const OPT_IN_KEY: Record<RefundSendTarget, string> = {
  shopify: 'refundsThroughShopify',
  amazon: 'refundsEnabled',
  empik: 'refundsThroughMarketplace',
};

export function useRefundSendTarget(
  sourceConnectionId: string | null | undefined
): RefundSendTarget | null {
  const query = useConnectionQuery(sourceConnectionId ?? '');
  const platformType = query.data?.platformType;
  const target = RefundSendTargetValues.find((value) => value === platformType);
  if (target === undefined) {
    return null;
  }
  return query.data?.publicConfig?.[OPT_IN_KEY[target]] === true ? target : null;
}
