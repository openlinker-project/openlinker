/**
 * useFulfilmentOwnedConnectionIds (#2118)
 *
 * The ids of connections whose operator declared "this system packs and ships
 * orders itself". Derived from the connections query the orders pages already
 * load, so it costs no extra request. Empty while the query is loading or has
 * failed, which keeps today's behaviour (the packing affordances stay visible):
 * an unknown flag must never hide a control.
 *
 * @module features/orders/hooks
 */
import { useMemo } from 'react';
import { readFulfilmentOwnedByDestination, useConnectionsQuery } from '../../connections';

export function useFulfilmentOwnedConnectionIds(): ReadonlySet<string> {
  const connectionsQuery = useConnectionsQuery();
  return useMemo(() => {
    const ids = new Set<string>();
    (connectionsQuery.data ?? []).forEach((connection) => {
      if (readFulfilmentOwnedByDestination(connection.config)) {
        ids.add(connection.id);
      }
    });
    return ids;
  }, [connectionsQuery.data]);
}
