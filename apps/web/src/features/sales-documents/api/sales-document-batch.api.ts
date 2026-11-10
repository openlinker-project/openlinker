/**
 * Sales-document batch API client (#3584)
 *
 * Thin module over `/sales-documents/batches/:connectionId` (#3583): overview,
 * queue, run history, one run, and "Run now". Schedules are written through the
 * connection config, not here.
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type {
  BatchOverview,
  BatchQueuePage,
  BatchRunDetail,
  BatchRunList,
  StartBatchRunResponse,
} from './sales-document-batch.types';

export interface SalesDocumentBatchApi {
  getOverview: (connectionId: string) => Promise<BatchOverview>;
  getQueue: (connectionId: string, after?: string, limit?: number) => Promise<BatchQueuePage>;
  listRuns: (connectionId: string, limit?: number) => Promise<BatchRunList>;
  getRun: (connectionId: string, runId: string) => Promise<BatchRunDetail>;
  startRun: (connectionId: string) => Promise<StartBatchRunResponse>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

const base = (connectionId: string): string =>
  `/sales-documents/batches/${encodeURIComponent(connectionId)}`;

export function createSalesDocumentBatchApi(request: ApiRequest): SalesDocumentBatchApi {
  return {
    getOverview(connectionId): Promise<BatchOverview> {
      return request<BatchOverview>(base(connectionId));
    },
    getQueue(connectionId, after, limit): Promise<BatchQueuePage> {
      const params = new URLSearchParams();
      if (after) params.set('after', after);
      if (limit !== undefined) params.set('limit', String(limit));
      const qs = params.toString();
      return request<BatchQueuePage>(`${base(connectionId)}/queue${qs ? `?${qs}` : ''}`);
    },
    listRuns(connectionId, limit): Promise<BatchRunList> {
      const qs = limit === undefined ? '' : `?limit=${limit}`;
      return request<BatchRunList>(`${base(connectionId)}/runs${qs}`);
    },
    getRun(connectionId, runId): Promise<BatchRunDetail> {
      return request<BatchRunDetail>(`${base(connectionId)}/runs/${encodeURIComponent(runId)}`);
    },
    startRun(connectionId): Promise<StartBatchRunResponse> {
      return request<StartBatchRunResponse>(`${base(connectionId)}/runs`, { method: 'POST' });
    },
  };
}
