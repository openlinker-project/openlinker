/**
 * Token Provider Port
 *
 * Supplies the ShipX bearer token per request. Kept as a port (not a static
 * string on the client) so a future adapter can refresh OAuth tokens, read from
 * a secrets store, or rotate per-connection credentials — the client just
 * `await`s a token before each call.
 *
 * @module domain/ports
 */

export interface TokenProviderPort {
  getToken(): Promise<string> | string;
}
