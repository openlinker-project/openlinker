/**
 * Subiekt Bridge Credentials Types (#753)
 *
 * Optional bridge authentication. The frozen #754 contract defines no
 * credential type — the bridge is a LAN service — so this is a thin, OPTIONAL
 * hook for a hardened deployment (a shared bridge token). The adapter resolves
 * it only when `connection.credentialsRef` is truthy.
 *
 * SECURITY: `bridgeToken` is a secret. OpenLinker never logs it and never puts
 * it into a response, an error message or a `ConnectionTestResult` of its own.
 *
 * The one way it can arrive from outside is the bridge's OWN 401 body, which
 * `SubiektBridgeHttpClient.redactToken` scrubs before an operator sees it - the
 * token verbatim, its `encodeURIComponent` form, and either in a different
 * case. That scrub has a FLOOR: it fires only for tokens of 8 characters or
 * more, because replacing a two-character token as a bare substring would shred
 * the bridge's own sentence, and the redaction would become the thing that made
 * the message unreadable.
 *
 * So the guarantee is bounded, and saying so here is the point: NOTHING bounds
 * this field's length. It is optional and operator-chosen, and this adapter
 * registers a connection-CONFIG shape validator but no credentials-shape
 * validator, so a token shorter than the floor is passed through if a bridge
 * echoes it. Refusing a short token at configuration time would close that gap
 * and was rejected: the bridges accept any non-empty value, so OpenLinker would
 * be stricter than the thing it talks to and a setup that works today would
 * stop saving.
 *
 * @module libs/integrations/subiekt/src/domain/types
 */

export interface SubiektBridgeCredentials {
  /** Optional bearer/shared token for the bridge. Never logged. */
  bridgeToken?: string;
}
