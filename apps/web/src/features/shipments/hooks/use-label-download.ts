/**
 * useLabelDownload
 *
 * One-shot action (NOT a TanStack mutation) that fetches a shipment's label
 * document via `apiClient.shipments.downloadLabel(id)` and triggers a browser
 * download. Filename extension is derived from `blob.type` (see
 * `lib/label-download`). There's nothing to cache, so this is deliberately
 * not a query/mutation hook.
 *
 * `download()` resolves with the raw failure, not a boolean (#2671). A
 * caller that read a hook-state `error` field inside `.then()` would close
 * over the PRE-CLICK render's value, which is stale by the time the promise
 * settles - the resolved value is the only way a caller can react to the
 * failure that just happened.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useCallback, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { extensionForBlob, triggerBlobDownload } from '../lib/label-download';

export type LabelDownloadResult = { ok: true } | { ok: false; error: unknown };

interface UseLabelDownload {
  /** Fetch + trigger the browser download. */
  download: (shipmentId: string) => Promise<LabelDownloadResult>;
  isDownloading: boolean;
}

export function useLabelDownload(): UseLabelDownload {
  const apiClient = useApiClient();
  const [isDownloading, setIsDownloading] = useState(false);

  const download = useCallback(
    async (shipmentId: string): Promise<LabelDownloadResult> => {
      setIsDownloading(true);
      try {
        const blob = await apiClient.shipments.downloadLabel(shipmentId);
        triggerBlobDownload(blob, `ol-shipment-${shipmentId}.${extensionForBlob(blob)}`);
        return { ok: true };
      } catch (caught) {
        return { ok: false, error: caught };
      } finally {
        setIsDownloading(false);
      }
    },
    [apiClient],
  );

  return { download, isDownloading };
}
