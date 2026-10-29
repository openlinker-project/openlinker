/**
 * Analytics CSV export mutation (#3590)
 *
 * Fetches the file through the authenticated client, takes the filename the
 * server chose, and hands the bytes to the browser. A failure (an over-wide
 * range, a network fault) is surfaced through the mutation's `error` - it
 * never reaches the browser as a broken download.
 *
 * @module features/analytics/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useToast } from '../../../shared/ui/toast-provider';
import type { AnalyticsCsvExportRequest } from '../api/analytics-export.types';

const FALLBACK_FILENAME = 'openlinker-analytics.csv';

/** Defers the revoke past the click: some engines cancel a download revoked synchronously. */
function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function useAnalyticsCsvExport(): UseMutationResult<
  string,
  Error,
  AnalyticsCsvExportRequest
> {
  const apiClient = useApiClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: async (request: AnalyticsCsvExportRequest) => {
      const file = await apiClient.analytics.exportCsv(request);
      const filename = file.filename ?? FALLBACK_FILENAME;
      saveBlob(file.blob, filename);
      return filename;
    },
    onSuccess: (filename) => {
      showToast({ tone: 'success', testId: 'export-status', title: 'CSV downloaded', description: filename });
    },
  });
}
