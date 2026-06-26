/**
 * useKsefFa3
 *
 * Provides FA(3) document access for accepted KSeF invoices (#1228, B5):
 *   - `loadView(invoiceId)` — fetch `kind=rendered` and expose as an object URL
 *     for inline display in a sandboxed `<iframe>` inside the `.doc-preview` area.
 *   - `downloadXml(invoiceId)` — fetch `kind=source` and trigger a browser download.
 *
 * The rendered view object URL is kept in state while visible; `clearView` revokes
 * it and resets to placeholder state. Unmount cleanup revokes any live URL.
 *
 * Neutral: keyed on the internal `invoice.id`, never on platform type (ADR-026).
 * Lives in `features/invoicing/hooks/` so it can use `useApiClient` freely
 * (dep direction: plugins/ksef → features/invoicing is explicitly allowed).
 *
 * @module features/invoicing/hooks
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Object URL for the rendered FA(3) HTML/blob, or `null` when not loaded. */
  viewObjectUrl: string | null;
  isLoadingView: boolean;
  viewError: Error | null;
  /**
   * Fetch the rendered FA(3) and expose it as an object URL for inline display.
   * Returns the caught error on failure (also stored in `viewError`), or `null`
   * on success — callers use the return value to avoid reading stale React state.
   */
  loadView: (invoiceId: string) => Promise<Error | null>;
  /** Clear the inline preview and revoke the object URL. */
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
  const [viewObjectUrl, setViewObjectUrl] = useState<string | null>(null);
  const [isLoadingView, setIsLoadingView] = useState(false);
  const [viewError, setViewError] = useState<Error | null>(null);
  const [isDownloadingXml, setIsDownloadingXml] = useState(false);
  const [xmlError, setXmlError] = useState<Error | null>(null);

  const objectUrlRef = useRef<string | null>(null);

  const revoke = useCallback((): void => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const clearView = useCallback((): void => {
    revoke();
    setViewObjectUrl(null);
    setViewError(null);
  }, [revoke]);

  const loadView = useCallback(
    async (invoiceId: string): Promise<Error | null> => {
      setIsLoadingView(true);
      setViewError(null);
      try {
        const blob = await apiClient.invoicing.downloadDocument(invoiceId, 'rendered');
        revoke();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setViewObjectUrl(url);
        return null;
      } catch (caught) {
        const err = caught instanceof Error ? caught : new Error(String(caught));
        setViewError(err);
        return err;
      } finally {
        setIsLoadingView(false);
      }
    },
    [apiClient, revoke],
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

  useEffect(() => revoke, [revoke]);

  return { viewObjectUrl, isLoadingView, viewError, loadView, clearView, isDownloadingXml, xmlError, downloadXml };
}
