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
 * A carrier may take a moment to prepare a freshly generated label (the API
 * answers 409 `SHIPMENT_LABEL_NOT_READY` meanwhile). That is a pending state, not a
 * failure: the hook waits and asks again, for up to `LABEL_READY_MAX_WAIT_MS`,
 * before giving up with the same 409 so the caller can say "still preparing".
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useCallback, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';
import { extensionForBlob, triggerBlobDownload } from '../lib/label-download';

/** Error code the API sends while the carrier is still preparing the label. */
export const LABEL_NOT_READY_CODE = 'SHIPMENT_LABEL_NOT_READY';

const LABEL_READY_MAX_WAIT_MS = 60_000;
const LABEL_READY_DEFAULT_POLL_MS = 2_000;
const LABEL_READY_MIN_POLL_MS = 1_000;
const LABEL_READY_MAX_POLL_MS = 5_000;

function isLabelNotReady(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409 && error.code === LABEL_NOT_READY_CODE;
}

/** The server's hint for when to ask again, clamped so a bad value cannot spin or stall. */
function pollDelayMs(error: ApiError): number {
  const hint = error.params.retryAfterMs;
  const ms = typeof hint === 'number' && Number.isFinite(hint) ? hint : LABEL_READY_DEFAULT_POLL_MS;
  return Math.min(LABEL_READY_MAX_POLL_MS, Math.max(LABEL_READY_MIN_POLL_MS, ms));
}

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
        const deadline = Date.now() + LABEL_READY_MAX_WAIT_MS;
        for (;;) {
          try {
            const blob = await apiClient.shipments.downloadLabel(shipmentId);
            triggerBlobDownload(blob, `ol-shipment-${shipmentId}.${extensionForBlob(blob)}`);
            return { ok: true };
          } catch (caught) {
            if (!isLabelNotReady(caught) || Date.now() + pollDelayMs(caught) > deadline) {
              throw caught;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, pollDelayMs(caught)));
          }
        }
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
