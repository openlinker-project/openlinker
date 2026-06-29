/**
 * useKsefUpoPreview
 *
 * One-shot action (NOT a TanStack mutation) that fetches a cleared/accepted
 * e-invoice's official UPO confirmation document via
 * `apiClient.invoicing.downloadUpo(id)` and exposes it as an in-memory object
 * URL for inline preview (#1234) — the readable counterpart to
 * `useKsefUpoDownload`, which forces a browser download. The official UPO is
 * the legible confirmation operators/accountants need; previewing it in a
 * sandboxed `<iframe>` avoids a round-trip to the downloads folder for a quick
 * look.
 *
 * Only previewable content types (PDF / XML) yield an `objectUrl`; anything
 * else is reported via `previewKind: 'unsupported'` so the slot can fall back
 * to the download-only action. The object URL is created on `open` and revoked
 * on `close` / unmount — safe single-owner lifecycle, never leaked.
 *
 * Neutral: keyed on the internal `invoice.id`, never on platform type (ADR-026).
 * Lives in `features/invoicing/hooks/` so it can use `useApiClient` freely;
 * the KSeF slot imports it from the `features/invoicing` barrel (dep direction:
 * plugins/ksef → features/invoicing is explicitly allowed).
 *
 * @module features/invoicing/hooks
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';

/** Previewable MIME types and the neutral preview kind each maps to. */
const PREVIEW_KIND_BY_MIME: Readonly<Record<string, 'pdf' | 'xml'>> = {
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

export type UpoPreviewKind = 'pdf' | 'xml' | 'unsupported';

function previewKindForBlob(blob: Blob): UpoPreviewKind {
  const mime = blob.type.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return PREVIEW_KIND_BY_MIME[mime] ?? 'unsupported';
}

interface UpoPreviewState {
  objectUrl: string;
  kind: UpoPreviewKind;
}

interface UseKsefUpoPreview {
  /** Fetch the UPO + open the inline preview. Resolves `true` on success,
   *  `false` when the fetch failed (the error is also exposed via `error`). */
  open: (invoiceId: string) => Promise<boolean>;
  /** Revoke the object URL and clear the preview. */
  close: () => void;
  /** The active preview, or `null` when closed. `kind === 'unsupported'` carries
   *  no `objectUrl` — the caller offers download instead of an inline render. */
  preview: UpoPreviewState | null;
  isLoading: boolean;
  error: Error | null;
}

export function useKsefUpoPreview(): UseKsefUpoPreview {
  const apiClient = useApiClient();
  const [preview, setPreview] = useState<UpoPreviewState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track the live object URL in a ref so `close` and the unmount cleanup can
  // revoke the latest URL without re-subscribing on every preview change.
  const objectUrlRef = useRef<string | null>(null);

  const revoke = useCallback((): void => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const close = useCallback((): void => {
    revoke();
    setPreview(null);
    setError(null);
  }, [revoke]);

  const open = useCallback(
    async (invoiceId: string): Promise<boolean> => {
      setIsLoading(true);
      setError(null);
      try {
        const blob = await apiClient.invoicing.downloadUpo(invoiceId);
        const kind = previewKindForBlob(blob);
        // Revoke any previously-open preview before replacing it.
        revoke();
        if (kind === 'unsupported') {
          setPreview({ objectUrl: '', kind });
          return true;
        }
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setPreview({ objectUrl, kind });
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [apiClient, revoke],
  );

  // Revoke on unmount so a still-open preview never leaks its object URL.
  useEffect(() => revoke, [revoke]);

  return { open, close, preview, isLoading, error };
}
