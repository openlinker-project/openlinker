import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { OkResponse } from '../api/auth.types';

export type ConfirmEmailState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; data: OkResponse }
  | { status: 'error'; error: unknown };

/**
 * Consumes a single-use email confirmation token as a one-shot async
 * operation, fired on a fresh/cold navigation (the user clicking the link
 * from their email client — not a client-side route transition).
 *
 * Uses plain useState + a manual API call instead of `useMutation`, mirroring
 * `useHandleAllegroCallback` (`features/allegro/hooks/use-handle-allegro-callback.ts`):
 * the TanStack Query mutation observer does not reliably trigger re-renders
 * after the request resolves on a cold navigation — a known edge case with
 * useSyncExternalStore subscriptions established during the first mount.
 * Relying on `useMutation`'s `isSuccess`/`isError` here would risk the
 * confirm-email page silently getting stuck on "Confirming your email…"
 * for exactly the users who followed a fresh link from their inbox.
 */
export function useConfirmEmail(token: string): {
  state: ConfirmEmailState;
  retry: () => void;
} {
  const apiClient = useApiClient();
  const hasCalledRef = useRef(false);
  const [state, setState] = useState<ConfirmEmailState>({ status: 'idle' });

  const call = (currentToken: string): void => {
    setState({ status: 'pending' });
    apiClient.auth
      .confirmEmail({ token: currentToken })
      .then((data) => {
        setState({ status: 'success', data });
      })
      .catch((err: unknown) => {
        setState({ status: 'error', error: err });
      });
  };

  useEffect(() => {
    if (!hasCalledRef.current && token) {
      hasCalledRef.current = true;
      call(token);
    }
    // Fire once per mount for the given token — the `hasCalledRef` guard
    // (not the dependency array) is what prevents a second call.
  }, [token]);

  return {
    state,
    retry: () => call(token),
  };
}
