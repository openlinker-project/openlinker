/**
 * Subiekt Bridge Credentials Types (#753)
 *
 * Optional bridge authentication. The frozen #754 contract defines no
 * credential type — the bridge is a LAN service — so this is a thin, OPTIONAL
 * hook for a hardened deployment (a shared bridge token). The adapter resolves
 * it only when `connection.credentialsRef` is truthy.
 *
 * SECURITY: `bridgeToken` is a secret and MUST NEVER be logged or echoed in any
 * response, error message, or `ConnectionTestResult`.
 *
 * @module libs/integrations/subiekt/src/domain/types
 */

export interface SubiektBridgeCredentials {
  /** Optional bearer/shared token for the bridge. Never logged. */
  bridgeToken?: string;
}
