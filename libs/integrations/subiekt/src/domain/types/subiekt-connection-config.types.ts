/**
 * Subiekt Connection Config Types (#753)
 *
 * Non-secret per-connection configuration for the Subiekt nexo invoicing
 * adapter. `bridgeBaseUrl` is the root URL of the LOCAL Windows bridge service
 * (#752) that wraps InsERT's Sfera SDK — NOT Subiekt itself. Named to make that
 * explicit. Decorator-free; the class-validator schema lives in the application
 * DTO (`application/dto/subiekt-connection-config.dto.ts`).
 *
 * @module libs/integrations/subiekt/src/domain/types
 */

export interface SubiektConnectionConfig {
  /**
   * Root URL of the local Subiekt bridge (#752). Must include protocol
   * (`http://`/`https://`). Validated at save-time by the config-shape
   * validator and again at HTTP-client construction (defense-in-depth SSRF
   * guard — see `infrastructure/http/subiekt-url-safety.ts`).
   */
  bridgeBaseUrl: string;

  /** Optional per-request timeout in milliseconds. */
  timeoutMs?: number;
}
