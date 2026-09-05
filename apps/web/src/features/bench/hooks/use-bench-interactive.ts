/**
 * Is the bench body reachable by a packer right now? (#2905 review, story A3)
 *
 * `useScannerInput` states the contract in its own `enabled` docblock — *"a
 * surface that is covered (the locked screen, a modal) passes `false`, so a scan
 * made while nobody is signed in is not attributed to the person who walked
 * away"* — and until this, neither consumer honoured it.
 *
 * `BenchIdentityOverlay` covers the body with `aria-hidden` and `inert`, and
 * neither does anything to a DOCUMENT-level `keydown` listener. `query.data`
 * also survives in the query cache after the idle lock clears the session, so
 * the parcel surface kept its lines, its scan match and its enabled listener. A
 * scan at a locked bench therefore minted a gesture id and fired `verifyUnit`
 * at a terminal nobody was standing at — landing as an alert UNDERNEATH the
 * lock. The API's 401 is the right backstop and the wrong primary: it spends a
 * real gesture id, and it reports as a failure the packer never sees.
 *
 * ## A CONTEXT, and the default is `true`
 *
 * `BenchSurface` takes its body as `children`, so there is no prop to thread
 * through. The default is `true` so a consumer mounted outside the surface —
 * every component test does exactly that — behaves as it did before: this
 * REMOVES a capability while locked, it does not add a precondition to scanning.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { createContext, useContext } from 'react';

/**
 * `true` while the bench is open to the signed-in packer; `false` while the
 * idle lock or the handover prompt covers it.
 */
export const BenchInteractiveContext = createContext<boolean>(true);

export function useBenchInteractive(): boolean {
  return useContext(BenchInteractiveContext);
}
