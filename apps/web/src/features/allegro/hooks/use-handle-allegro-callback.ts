import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { AllegroCallbackResponse } from '../api/allegro.api';

export type CallbackState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; data: AllegroCallbackResponse }
  | { status: 'error'; error: unknown };

/**
 * Handles the Allegro OAuth callback as a one-shot async operation.
 *
 * Uses plain useState + fetch instead of useMutation because the TanStack Query
 * mutation observer does not reliably trigger re-renders after the fetch resolves
 * on a fresh full-page navigation (the OAuth redirect). This is a known edge-case
 * with useSyncExternalStore subscriptions established during the first mount.
 *
 * The raw error (typically `ApiError`) is surfaced unchanged so callers can branch
 * on `details.code` rather than string-matching `error.message`.
 */
export function useHandleAllegroCallback(
  code: string | null,
  state: string | null,
): CallbackState {
  const apiClient = useApiClient();
  const hasCalledRef = useRef(false);
  const [callbackState, setCallbackState] = useState<CallbackState>({ status: 'idle' });

  useEffect(() => {
    if (!hasCalledRef.current && code && state) {
      hasCalledRef.current = true;
      // Strip `code`/`state` from the address bar so the OAuth grant is not
      // retained in browser history, bookmarks, or shared links. `useSearchParams`
      // has already captured the values, so this does not affect the current render.
      window.history.replaceState({}, '', window.location.pathname);
      setCallbackState({ status: 'pending' });

      const capturedCode = code;
      const capturedState = state;

      apiClient.allegro
        .handleCallback(capturedCode, capturedState)
        .then((data) => {
          setCallbackState({ status: 'success', data });
        })
        .catch((err: unknown) => {
          setCallbackState({ status: 'error', error: err });
        });
    }
  }, [code, state, apiClient]);

  return callbackState;
}
