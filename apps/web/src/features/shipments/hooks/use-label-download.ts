/**
 * useLabelDownload
 *
 * One-shot action (NOT a TanStack mutation) that fetches a shipment's label
 * document via `apiClient.shipments.downloadLabel(id)` and triggers a browser
 * download. Filename extension is derived from `blob.type` (see
 * `lib/label-download`). Exposes local `{ download, isDownloading, error }` —
 * there's nothing to cache, so this is deliberately not a query/mutation hook.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useCallback, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { extensionForBlob, triggerBlobDownload } from '../lib/label-download';

interface UseLabelDownload {
  /** Fetch + trigger the browser download. Resolves `true` on success, `false`
   *  when the fetch failed (the error is also exposed via `error`). */
  download: (shipmentId: string) => Promise<boolean>;
  isDownloading: boolean;
  error: Error | null;
}

export function useLabelDownload(): UseLabelDownload {
  const apiClient = useApiClient();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const download = useCallback(
    async (shipmentId: string): Promise<boolean> => {
      setIsDownloading(true);
      setError(null);
      try {
        const blob = await apiClient.shipments.downloadLabel(shipmentId);
        triggerBlobDownload(blob, `ol-shipment-${shipmentId}.${extensionForBlob(blob)}`);
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        return false;
      } finally {
        setIsDownloading(false);
      }
    },
    [apiClient],
  );

  return { download, isDownloading, error };
}
