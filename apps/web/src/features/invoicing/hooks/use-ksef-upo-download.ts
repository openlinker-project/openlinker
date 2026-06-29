/**
 * useKsefUpoDownload
 *
 * One-shot action (NOT a TanStack mutation) that fetches a cleared/accepted
 * e-invoice's official UPO confirmation document via
 * `apiClient.invoicing.downloadUpo(id)` and triggers a browser download
 * (#1234). Filename extension is derived from `blob.type` (PDF / XML).
 * Exposes local `{ download, isDownloading, error }` — there's nothing to
 * cache, so this is deliberately not a query/mutation hook.
 *
 * Neutral: keyed on the internal `invoice.id`, never on platform type (ADR-026).
 * Lives in `features/invoicing/hooks/` so it can use `useApiClient` freely;
 * the KSeF slot imports it from the `features/invoicing` barrel (dep direction:
 * plugins/ksef → features/invoicing is explicitly allowed).
 *
 * @module features/invoicing/hooks
 */
import { useCallback, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

function extensionForBlob(blob: Blob): string {
  const mime = blob.type.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return EXTENSION_BY_MIME[mime] ?? 'bin';
}

/**
 * Trigger a browser download for an already-fetched blob via an in-memory
 * object URL + a programmatic `<a download>` click. Defers `revokeObjectURL`
 * past the current tick — some engines cancel the in-flight download if the URL
 * is revoked synchronously after `click()`. Mirrors the shipments label-download
 * helper's anchor lifecycle (`features/shipments/lib/label-download.ts`).
 */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

interface UseKsefUpoDownload {
  /** Fetch + trigger the browser download. Resolves `true` on success, `false`
   *  when the fetch failed (the error is also exposed via `error`). */
  download: (invoiceId: string) => Promise<boolean>;
  isDownloading: boolean;
  error: Error | null;
}

export function useKsefUpoDownload(): UseKsefUpoDownload {
  const apiClient = useApiClient();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const download = useCallback(
    async (invoiceId: string): Promise<boolean> => {
      setIsDownloading(true);
      setError(null);
      try {
        const blob = await apiClient.invoicing.downloadUpo(invoiceId);
        triggerBlobDownload(blob, `ol-upo-${invoiceId}.${extensionForBlob(blob)}`);
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
