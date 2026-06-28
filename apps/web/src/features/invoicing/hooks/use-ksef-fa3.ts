/**
 * useKsefFa3
 *
 * Provides FA(3) document access for accepted KSeF invoices (#1228, B5):
 *   - `loadView(invoiceId)` — fetch `kind=source` (XML) and expose as raw text
 *     for client-side parsing by `KsefFa3View`.
 *   - `downloadXml(invoiceId)` — fetch `kind=source` and trigger a browser download.
 *
 * Neutral: keyed on the internal `invoice.id`, never on platform type (ADR-026).
 * Lives in `features/invoicing/hooks/` so it can use `useApiClient` freely
 * (dep direction: plugins/ksef → features/invoicing is explicitly allowed).
 *
 * @module features/invoicing/hooks
 */
import { useCallback, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';

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

function xmlFilename(invoiceId: string): string {
  return `ol-fa3-${invoiceId}.xml`;
}

interface UseKsefFa3 {
  /** Raw XML text of the FA(3) source document, for client-side parsing by `KsefFa3View`. */
  viewText: string | null;
  isLoadingView: boolean;
  viewError: Error | null;
  /**
   * Fetch the source FA(3) XML and expose it as raw text for `KsefFa3View`.
   * Returns the caught error on failure (also stored in `viewError`), or `null`
   * on success — callers use the return value to avoid reading stale React state.
   */
  loadView: (invoiceId: string) => Promise<Error | null>;
  /** Clear the inline preview and reset to placeholder state. */
  clearView: () => void;
  isDownloadingXml: boolean;
  xmlError: Error | null;
  /**
   * Fetch the source FA(3) XML and trigger a browser download.
   * Returns the caught error on failure (also stored in `xmlError`), or `null`
   * on success — callers use the return value to avoid reading stale React state.
   */
  downloadXml: (invoiceId: string) => Promise<Error | null>;
}

export function useKsefFa3(): UseKsefFa3 {
  const apiClient = useApiClient();
  const [viewText, setViewText] = useState<string | null>(null);
  const [isLoadingView, setIsLoadingView] = useState(false);
  const [viewError, setViewError] = useState<Error | null>(null);
  const [isDownloadingXml, setIsDownloadingXml] = useState(false);
  const [xmlError, setXmlError] = useState<Error | null>(null);

  const clearView = useCallback((): void => {
    setViewText(null);
    setViewError(null);
  }, []);

  const loadView = useCallback(
    async (invoiceId: string): Promise<Error | null> => {
      setIsLoadingView(true);
      setViewError(null);
      try {
        const blob = await apiClient.invoicing.downloadDocument(invoiceId, 'source');
        const text = await blob.text();
        setViewText(text);
        return null;
      } catch (caught) {
        const err = caught instanceof Error ? caught : new Error(String(caught));
        setViewError(err);
        return err;
      } finally {
        setIsLoadingView(false);
      }
    },
    [apiClient],
  );

  const downloadXml = useCallback(
    async (invoiceId: string): Promise<Error | null> => {
      setIsDownloadingXml(true);
      setXmlError(null);
      try {
        const blob = await apiClient.invoicing.downloadDocument(invoiceId, 'source');
        triggerBlobDownload(blob, xmlFilename(invoiceId));
        return null;
      } catch (caught) {
        const err = caught instanceof Error ? caught : new Error(String(caught));
        setXmlError(err);
        return err;
      } finally {
        setIsDownloadingXml(false);
      }
    },
    [apiClient],
  );

  return { viewText, isLoadingView, viewError, loadView, clearView, isDownloadingXml, xmlError, downloadXml };
}
