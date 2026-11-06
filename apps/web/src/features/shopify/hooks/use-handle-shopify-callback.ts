import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ShopifyCallbackResponse } from '../api/shopify.api';

export type ShopifyCallbackState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; data: ShopifyCallbackResponse }
  | { status: 'error'; error: unknown };

/**
 * Sends the Shopify OAuth redirect query to the API once, then removes it from
 * the address bar so the one-time code is not kept in history. The WHOLE query
 * goes, because Shopify's `hmac` covers every parameter it sent.
 *
 * Plain state rather than `useMutation` for the reason the Allegro callback
 * hook records: the mutation observer does not reliably re-render after a fetch
 * started on a fresh full-page navigation.
 */
export function useHandleShopifyCallback(rawQuery: string | null): ShopifyCallbackState {
  const apiClient = useApiClient();
  const calledRef = useRef(false);
  const [state, setState] = useState<ShopifyCallbackState>({ status: 'idle' });

  useEffect(() => {
    if (calledRef.current || rawQuery === null) return;
    calledRef.current = true;
    window.history.replaceState({}, '', window.location.pathname);
    setState({ status: 'pending' });
    apiClient.shopify
      .handleCallback(rawQuery)
      .then((data) => setState({ status: 'success', data }))
      .catch((error: unknown) => setState({ status: 'error', error }));
  }, [apiClient, rawQuery]);

  return state;
}
