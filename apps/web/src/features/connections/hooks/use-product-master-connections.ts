import type { UseQueryResult } from '@tanstack/react-query';
import { useConnectionsQuery } from './use-connections-query';
import type { Connection } from '../api/connections.types';

export interface ProductMasterConnectionsResult {
  connectionsQuery: UseQueryResult<Connection[]>;
  productMasterConnections: Connection[];
  autoSelectedConnectionId: string | undefined;
}

/**
 * Returns active ProductMaster connections and auto-selects the only one if exactly one exists.
 * Encapsulates the fetch + filter + auto-select pattern used in integration setup forms.
 */
export function useProductMasterConnections(): ProductMasterConnectionsResult {
  const connectionsQuery = useConnectionsQuery();

  const productMasterConnections = (connectionsQuery.data ?? []).filter(
    (c) => c.status === 'active' && c.enabledCapabilities.includes('ProductMaster'),
  );

  const autoSelectedConnectionId =
    productMasterConnections.length === 1 ? productMasterConnections[0].id : undefined;

  return { connectionsQuery, productMasterConnections, autoSelectedConnectionId };
}
