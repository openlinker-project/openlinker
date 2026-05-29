/**
 * useLabelPdfDownload
 *
 * One-shot action (NOT a TanStack mutation) that fetches a shipment's label
 * document via `apiClient.shipments.downloadLabel(id)` and triggers a browser
 * download through an in-memory object URL + programmatic `<a download>` click.
 *
 * Filename: a blob-URL download cannot read the server's `Content-Disposition`
 * header (the object URL carries no HTTP headers), so the extension is derived
 * from `blob.type` — which `Response.blob()` populates from the response
 * `Content-Type`. This mirrors the backend's content-type → extension mapping
 * so a PDF/ZPL/PNG label saves with the right extension.
 *
 * Exposes local `{ download, isDownloading, error }` state — there's nothing to
 * cache, so this is deliberately not a query/mutation hook.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useCallback, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Map a label blob's MIME type to a download-filename extension. Mirrors the
 * backend `extensionForContentType` (apps/api shipment.controller) — the two
 * can't share code across the FE/BE boundary, so the small map is duplicated.
 */
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'application/zpl': 'zpl',
  'application/x-zpl': 'zpl',
  'text/zpl': 'zpl',
  'application/epl': 'epl',
  'application/x-epl': 'epl',
};

function extensionForBlob(blob: Blob): string {
  const mime = blob.type.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return EXTENSION_BY_MIME[mime] ?? 'bin';
}

interface UseLabelPdfDownload {
  /** Fetch + trigger the browser download. Resolves `true` on success, `false`
   *  when the fetch failed (the error is also exposed via `error`). */
  download: (shipmentId: string) => Promise<boolean>;
  isDownloading: boolean;
  error: Error | null;
}

export function useLabelPdfDownload(): UseLabelPdfDownload {
  const apiClient = useApiClient();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const download = useCallback(
    async (shipmentId: string): Promise<boolean> => {
      setIsDownloading(true);
      setError(null);
      let objectUrl: string | null = null;
      try {
        const blob = await apiClient.shipments.downloadLabel(shipmentId);
        objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `ol-shipment-${shipmentId}.${extensionForBlob(blob)}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        // Defer revoke past the current tick: some engines cancel the in-flight
        // download if the object URL is revoked synchronously after click().
        if (objectUrl) {
          const toRevoke = objectUrl;
          setTimeout(() => URL.revokeObjectURL(toRevoke), 0);
          objectUrl = null;
        }
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        return false;
      } finally {
        // Only fires on the error path (success nulls `objectUrl` after
        // scheduling the deferred revoke above).
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        setIsDownloading(false);
      }
    },
    [apiClient],
  );

  return { download, isDownloading, error };
}
