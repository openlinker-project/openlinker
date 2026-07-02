/**
 * useInvoiceRenderedDocumentDownload
 *
 * One-shot action (NOT a TanStack mutation) that fetches the provider's
 * server-rendered document (`kind=rendered` — e.g. Infakt's PDF, #1321) via
 * `apiClient.invoicing.downloadDocument(id, 'rendered')` and triggers a
 * browser download. Mirrors `useKsefUpoDownload`'s shape exactly; kept as a
 * separate hook (rather than generalizing `useKsefUpoDownload`) because that
 * hook is scoped to the dedicated `/upo` route, while this one goes through
 * the neutral `/document?kind=rendered` route any provider can serve.
 *
 * Neutral: keyed on the internal `invoice.id`, never on platform type (ADR-026).
 * Lives in `features/invoicing/hooks/` so it can use `useApiClient` freely;
 * per-provider `invoiceDetailSection` slots import it from the
 * `features/invoicing` barrel (dep direction: plugins/* → features/invoicing
 * is explicitly allowed).
 *
 * @module features/invoicing/hooks
 */
import { useCallback, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'text/html': 'html',
};

function extensionForBlob(blob: Blob): string {
  const mime = blob.type.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return EXTENSION_BY_MIME[mime] ?? 'bin';
}

/**
 * Trigger a browser download for an already-fetched blob via an in-memory
 * object URL + a programmatic `<a download>` click. Defers `revokeObjectURL`
 * past the current tick — some engines cancel the in-flight download if the
 * URL is revoked synchronously after `click()`.
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

interface UseInvoiceRenderedDocumentDownload {
  /** Fetch + trigger the browser download. Resolves `true` on success, `false`
   *  when the fetch failed (the error is also exposed via `error`). */
  download: (invoiceId: string) => Promise<boolean>;
  isDownloading: boolean;
  error: Error | null;
}

export function useInvoiceRenderedDocumentDownload(): UseInvoiceRenderedDocumentDownload {
  const apiClient = useApiClient();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const download = useCallback(
    async (invoiceId: string): Promise<boolean> => {
      setIsDownloading(true);
      setError(null);
      try {
        const blob = await apiClient.invoicing.downloadDocument(invoiceId, 'rendered');
        triggerBlobDownload(blob, `ol-invoice-${invoiceId}.${extensionForBlob(blob)}`);
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
