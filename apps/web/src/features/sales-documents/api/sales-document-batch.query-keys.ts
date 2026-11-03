/**
 * Sales-document batch query keys (#3584)
 *
 * @module apps/web/src/features/sales-documents/api
 */
export const salesDocumentBatchQueryKeys = {
  all: ['sales-document-batch'] as const,
  connection: (connectionId: string) => ['sales-document-batch', connectionId] as const,
  overview: (connectionId: string) => ['sales-document-batch', connectionId, 'overview'] as const,
  queue: (connectionId: string) => ['sales-document-batch', connectionId, 'queue'] as const,
  runs: (connectionId: string) => ['sales-document-batch', connectionId, 'runs'] as const,
  run: (connectionId: string, runId: string) =>
    ['sales-document-batch', connectionId, 'run', runId] as const,
};
