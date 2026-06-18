/**
 * Erli Connection Types
 *
 * Credential + config shapes for an Erli connection, plus the default Shop API
 * base URL. Erli auth is a single static bearer API key (ADR-025) — no OAuth,
 * no refresh — so credentials carry only `apiKey`. The base URL is an optional
 * config override: the sandbox host (`https://sandbox.erli.dev/svc/shop-api`,
 * confirmed by the #992 spike) drops in via `connection.config.baseUrl` with no
 * code change.
 *
 * Lives in `domain/types/` (not infrastructure) so the application-layer
 * factory can depend on it without inverting the hexagonal layer direction —
 * mirrors the Allegro/PrestaShop connection-type layout.
 *
 * @module libs/integrations/erli/src/domain/types
 */

/** Encrypted credentials for an Erli connection (resolved via host.credentialsResolver). */
export interface ErliCredentials {
  apiKey: string;
}

/** Non-secret per-connection config stored on `connection.config`. */
export interface ErliConnectionConfig {
  /** Optional Shop API base URL override; defaults to {@link ERLI_DEFAULT_BASE_URL}. */
  baseUrl?: string;
}

/**
 * Production Erli Shop API base URL (https://erli.pl/svc/shop-api/doc/). The
 * sandbox host (`https://sandbox.erli.dev/svc/shop-api`, confirmed by the #992
 * spike) overrides this through `connection.config.baseUrl`.
 *
 * The base carries a path prefix (`/svc/shop-api`). The #981 client normalizes
 * the base to a trailing slash and strips leading slashes from request paths,
 * so the prefix survives the `new URL(path, base)` join and an absolute path
 * cannot escape the configured origin. The host itself is constrained to the
 * Erli allowlist — see `domain/policies/erli-base-url.policy.ts`.
 */
export const ERLI_DEFAULT_BASE_URL = 'https://erli.pl/svc/shop-api';
