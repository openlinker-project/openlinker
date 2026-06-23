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

/**
 * Erli dispatch (handling) time — the time needed to source the goods and
 * prepare them for shipment. Erli's `POST /products/{externalId}` requires
 * `dispatchTime`; `period` is mandatory, `unit` defaults to working `day`s.
 * `period` bounds are unit-dependent (hour ≤ 24, month ≤ 12, day unbounded).
 */
export type ErliDispatchTimeUnit = 'hour' | 'day' | 'month';
export interface ErliDispatchTime {
  unit?: ErliDispatchTimeUnit;
  period: number;
}

/** Non-secret per-connection config stored on `connection.config`. */
export interface ErliConnectionConfig {
  /** Optional Shop API base URL override; defaults to {@link ERLI_DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /**
   * Shop-wide default dispatch time applied to every created offer when the
   * per-offer override (`overrides.platformParams.dispatchTime`) is absent.
   * Erli requires `dispatchTime` on offer create, so either this default or
   * the per-offer override must be present — offer creation fails closed
   * otherwise (never sends an invalid body).
   */
  defaultDispatchTime?: ErliDispatchTime;
  /**
   * Public OpenLinker base URL Erli should POST webhooks back to (#996). The
   * webhook provisioner registers `PUT /hooks/{hookName}` with
   * `{ url: <callbackBaseUrl>/webhooks/erli/<connectionId> }`. Required to
   * configure webhooks (the provisioner fails with a clear message when absent);
   * e.g. `http://host.docker.internal:3000` in dev, the public OL URL in prod.
   */
  callbackBaseUrl?: string;
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
