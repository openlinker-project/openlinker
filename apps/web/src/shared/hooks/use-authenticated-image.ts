/**
 * An `<img>` that needs a bearer token (#3340 follow-up)
 *
 * `GET /products/:id/images/:index` is behind the ordinary route guard, and
 * the access token lives in memory and travels as an `Authorization` header
 * (`shared/auth/jwt-bearer-session-adapter.ts` — it is deliberately NOT in
 * `localStorage` and deliberately NOT a cookie the browser would attach on
 * its own). An `<img src>` cannot carry a header, so the browser's own image
 * load would arrive unauthenticated and be refused.
 *
 * So the bytes are fetched the same way every other authenticated read is,
 * and handed to the `<img>` as an object url.
 *
 * ## The alternatives, and why not
 *
 * Making the route public would put the operator's catalogue imagery behind
 * nothing but an unguessable id, which is not authorization — and the
 * deny-by-default route rule (#2079) exists precisely to stop that reasoning.
 * A signed short-lived url would work and is what a high-volume image service
 * would do; it is more machinery than this needs while the images are
 * thumbnails on screens a handful of people have open.
 *
 * ## What it costs, stated
 *
 * One request and one object url per image, revoked when the path changes or
 * the component unmounts — a leaked object url holds its bytes for the life
 * of the document. The browser's HTTP cache still applies (the route sends
 * `Cache-Control: private, max-age=3600`), so a re-render inside the hour
 * costs no network.
 *
 * @module apps/web/src/shared/hooks
 */
import { useEffect, useState } from 'react';

import { useApiClient } from '../../app/api/api-client-provider';

export type AuthenticatedImageState =
  /** No path was given — the thing has no picture. Not a failure. */
  | { readonly status: 'absent' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly objectUrl: string }
  | { readonly status: 'failed' };

export function useAuthenticatedImage(path: string | null | undefined): AuthenticatedImageState {
  const apiClient = useApiClient();
  const [state, setState] = useState<AuthenticatedImageState>({ status: 'absent' });

  useEffect(() => {
    if (path === null || path === undefined || path === '') {
      setState({ status: 'absent' });
      return;
    }

    // Guards against a late response for a path the component has moved on
    // from — the bench hero swaps its item as the packer scans, so an
    // in-flight request for the previous item must not paint over the new one.
    let live = true;
    let created: string | null = null;
    setState({ status: 'loading' });

    void apiClient.requestBlob(path).then(
      (blob) => {
        if (!live) return;
        created = URL.createObjectURL(blob);
        setState({ status: 'ready', objectUrl: created });
      },
      () => {
        if (!live) return;
        // A 404 (no such image, or the shop did not answer) and a network
        // failure are one state to a caller painting a picture: there is
        // nothing to show. The API log distinguishes them for an operator.
        setState({ status: 'failed' });
      }
    );

    return () => {
      live = false;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [apiClient, path]);

  return state;
}
