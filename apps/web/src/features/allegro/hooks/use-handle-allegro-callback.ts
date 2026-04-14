import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { AllegroCallbackResponse } from '../api/allegro.api';

export type CallbackState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; data: AllegroCallbackResponse }
  | { status: 'error'; error: string };

/**
 * Handles the Allegro OAuth callback as a one-shot async operation.
 *
 * Uses plain useState + fetch instead of useMutation because the TanStack Query
 * mutation observer does not reliably trigger re-renders after the fetch resolves
 * on a fresh full-page navigation (the OAuth redirect). This is a known edge-case
 * with useSyncExternalStore subscriptions established during the first mount.
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
          const message = err instanceof Error ? err.message : 'Unknown error';
          setCallbackState({ status: 'error', error: message });
        });
    }
  }, [code, state, apiClient]);

  return callbackState;
}
