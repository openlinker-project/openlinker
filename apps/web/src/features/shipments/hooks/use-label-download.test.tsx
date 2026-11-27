/**
 * useLabelDownload - a carrier that is still preparing the label (409
 * `SHIPMENT_LABEL_NOT_READY`) is waited for, not reported as a failure.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { useLabelDownload } from './use-label-download';

const downloadLabel = vi.fn();

vi.mock('../../../app/api/api-client-provider', () => ({
  useApiClient: () => ({ shipments: { downloadLabel } }),
}));
vi.mock('../lib/label-download', () => ({
  extensionForBlob: () => 'pdf',
  triggerBlobDownload: vi.fn(),
}));

function notReady(): ApiError {
  return new ApiError('not ready', 409, {
    code: 'SHIPMENT_LABEL_NOT_READY',
    message: 'not ready',
    params: { retryAfterMs: 1000 },
  });
}

describe('useLabelDownload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    downloadLabel.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should retry while the label is not ready and succeed once it is', async () => {
    downloadLabel
      .mockRejectedValueOnce(notReady())
      .mockRejectedValueOnce(notReady())
      .mockResolvedValueOnce(new Blob(['%PDF'], { type: 'application/pdf' }));
    const { result } = renderHook(() => useLabelDownload());

    const pending = result.current.download('ol_shipment_1');
    await vi.advanceTimersByTimeAsync(3000);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(downloadLabel).toHaveBeenCalledTimes(3);
  });

  it('should give up with the not-ready error when the wait runs out', async () => {
    downloadLabel.mockRejectedValue(notReady());
    const { result } = renderHook(() => useLabelDownload());

    const pending = result.current.download('ol_shipment_1');
    await vi.advanceTimersByTimeAsync(70_000);

    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && (outcome.error as ApiError).code).toBe('SHIPMENT_LABEL_NOT_READY');
  });

  it('should not retry any other failure', async () => {
    downloadLabel.mockRejectedValue(new ApiError('nope', 404, { message: 'nope' }));
    const { result } = renderHook(() => useLabelDownload());

    const outcome = await result.current.download('ol_shipment_1');

    expect(outcome.ok).toBe(false);
    expect(downloadLabel).toHaveBeenCalledTimes(1);
  });
});
