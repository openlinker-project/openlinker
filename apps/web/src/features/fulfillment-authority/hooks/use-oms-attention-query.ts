/**
 * useOmsAttentionQuery
 *
 * The cross-surface read behind the §4 badges on `/connections` and `/products`.
 *
 * ## It is a projection, not a second endpoint
 *
 * It wraps {@link useWhoDecidesStatusQuery} — the same query, the same cache key
 * — so a connection card and the who-decides page can never disagree about the
 * same install. A dedicated endpoint would have re-derived the answer, and two
 * derivations of one fact is exactly what §4 exists to prevent.
 *
 * ## The two projections it offers
 *
 * `byConnectionId` answers *does this connection have a state that RENDERS HERE
 * named against it*, for a card badge. Both halves are load-bearing: an item's
 * `connectionIds` say which connections a state is ABOUT, while its `surfaces`
 * say where it renders — `authority-status.types.ts` is explicit that the
 * descriptor table answers the second question "rather than letting each
 * consumer re-derive it". Keying on `connectionIds` alone happens to be right
 * today only because all three connection-carrying states declare `'connection'`;
 * a later state naming connections but rendering on the ORDER surface would
 * badge the connections table for a reason nothing there can act on. `forReason` answers *is this state live anywhere*, for a
 * page-level notice about a state whose EFFECT lands on rows OL cannot name
 * individually — A1-U is derived from `Connection.config`, so no per-product
 * datum exists and inventing one would assert knowledge OL does not have.
 *
 * @module apps/web/src/features/fulfillment-authority/hooks
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 4.3
 */
import { useMemo } from 'react';

import { useWhoDecidesStatusQuery } from './use-who-decides-status-query';
import type { AuthorityAttentionItem } from '../api/who-decides.types';
import type { AuthorityAttentionReason } from '../lib/attention-reason';

export interface OmsAttentionProjection {
  /** Every counted state naming this connection. Empty when the read failed. */
  readonly byConnectionId: ReadonlyMap<string, readonly AuthorityAttentionItem[]>;
  /** The counted items for one reason, or an empty list. */
  readonly forReason: (reason: AuthorityAttentionReason) => readonly AuthorityAttentionItem[];
  readonly isLoading: boolean;
}

/**
 * The connection-surface projection, as a pure function so it can be asserted
 * without mounting a query.
 *
 * Exported for its spec, not for a second consumer.
 */
export function projectAttentionByConnection(
  items: readonly AuthorityAttentionItem[],
): ReadonlyMap<string, readonly AuthorityAttentionItem[]> {
  const byConnectionId = new Map<string, AuthorityAttentionItem[]>();
  for (const item of items) {
    // `connectionIds` says which connections the state is ABOUT; `surfaces` says
    // where it renders. Both are required — see the module docblock.
    if (!item.surfaces.includes('connection')) {
      continue;
    }
    for (const connectionId of item.connectionIds) {
      const existing = byConnectionId.get(connectionId);
      if (existing) {
        existing.push(item);
      } else {
        byConnectionId.set(connectionId, [item]);
      }
    }
  }
  return byConnectionId;
}

export function useOmsAttentionQuery(): OmsAttentionProjection {
  const statusQuery = useWhoDecidesStatusQuery();
  const counted = statusQuery.data?.attention.counted;

  return useMemo(() => {
    const items = counted ?? [];
    return {
      byConnectionId: projectAttentionByConnection(items),
      // A failed read degrades to "nothing to report" rather than to an error
      // banner on a page whose subject is products or connections: the badge is
      // supplementary, and losing it must never cost the operator the list.
      forReason: (reason) => items.filter((item) => item.reason === reason),
      isLoading: statusQuery.isLoading,
    };
  }, [counted, statusQuery.isLoading]);
}
