/**
 * useProtocolDownload
 *
 * One-shot action (NOT a TanStack mutation) that fetches a carrier handover
 * protocol via `apiClient.shipments.downloadProtocol(shipmentIds)` and triggers
 * a browser download. The BE rejects mixed-carrier batches, so callers pass a
 * single carrier's dispatched-shipment ids and the carrier label for the
 * filename. Exposes local `{ download, isDownloading, error }`.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useCallback, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { extensionForBlob, triggerBlobDownload } from '../lib/label-download';

interface UseProtocolDownload {
  /** Fetch + trigger the protocol download for one carrier's shipments.
   *  Resolves `true` on success, `false` on failure (error also on `error`). */
  download: (shipmentIds: string[], carrierLabel?: string) => Promise<boolean>;
  isDownloading: boolean;
  error: Error | null;
}

function filenameSlug(carrierLabel: string | undefined): string {
  const slug = (carrierLabel ?? 'handover')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'handover';
}

export function useProtocolDownload(): UseProtocolDownload {
  const apiClient = useApiClient();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const download = useCallback(
    async (shipmentIds: string[], carrierLabel?: string): Promise<boolean> => {
      setIsDownloading(true);
      setError(null);
      try {
        const blob = await apiClient.shipments.downloadProtocol(shipmentIds);
        triggerBlobDownload(
          blob,
          `ol-${filenameSlug(carrierLabel)}-protocol.${extensionForBlob(blob)}`,
        );
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
