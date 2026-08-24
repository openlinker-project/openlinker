/**
 * useSalesDocumentRows (#2159)
 *
 * Thin projection over the existing connections list query — no new list
 * endpoint. Filters + shapes into `SalesDocumentRow[]` via the pure
 * `deriveSalesDocumentRows`, so the query hook itself stays a one-liner.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useConnectionsQuery, type Connection } from '../../connections';
import { deriveSalesDocumentRows } from '../lib/derive-sales-document-rows';
import type { SalesDocumentRow } from '../api/sales-documents.types';

export interface UseSalesDocumentRowsResult {
  connectionsQuery: UseQueryResult<Connection[]>;
  rows: SalesDocumentRow[];
}

export function useSalesDocumentRows(): UseSalesDocumentRowsResult {
  const connectionsQuery = useConnectionsQuery();

  const rows = useMemo(
    () => deriveSalesDocumentRows(connectionsQuery.data ?? []),
    [connectionsQuery.data],
  );

  return { connectionsQuery, rows };
}
