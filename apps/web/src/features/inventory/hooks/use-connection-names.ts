/**
 * useConnectionNames (#3568)
 *
 * Connection id -> name, from the ONE batched connections read, so the stock
 * history never prints a raw connection id when a name is known. Deliberately
 * unfiltered by status: a disabled master still owns its historical rows.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useMemo } from 'react';
import { useConnectionsQuery } from '../../connections';

export function useConnectionNames(): ReadonlyMap<string, string> {
  const query = useConnectionsQuery();
  return useMemo(() => {
    const map = new Map<string, string>();
    (query.data ?? []).forEach((connection) => map.set(connection.id, connection.name));
    return map;
  }, [query.data]);
}
