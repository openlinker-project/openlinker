/**
 * Connection Credentials Shape Validator Port (#586)
 *
 * Contract for per-plugin validation of raw `credentials` payloads submitted
 * on connection create / credential rotation. Validates **shape only** — the
 * post-resolve "do these credentials actually authenticate" check is a
 * different concern handled by `ConnectionTesterPort` against the live API.
 *
 * Each plugin registers an adapter via
 * `host.connectionCredentialsShapeValidatorRegistry.register(adapterKey, …)`
 * in `AdapterPlugin.register(host)`. The registry is keyed by **adapterKey**
 * (consistent with the other host registries).
 *
 * Implementations throw `InvalidCredentialsShapeException` (a core domain
 * exception) on shape failure. `ConnectionService` catches and maps to
 * `BadRequestException` at the API boundary.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link ConnectionCredentialsShapeValidatorRegistryService} for the registry
 * @see {@link InvalidCredentialsShapeException} for the failure exception
 */
export interface ConnectionCredentialsShapeValidatorPort {
  /**
   * Validate the raw credentials payload's shape.
   *
   * Async-shaped (`Promise<void>`) for symmetry with
   * {@link ConnectionConfigShapeValidatorPort} and future-proofing — a
   * plugin that needs to do a network round-trip during shape validation
   * (e.g. internal lookup of an issued API-key prefix) can opt in without
   * a contract change. Sync implementations just `await` cheaply.
   *
   * @param credentials - The raw credential payload, exactly as the operator
   *   sent it. Shape is plugin-specific (PrestaShop wants
   *   `webserviceApiKey`, OAuth plugins want `accessToken` + `refreshToken`,
   *   etc.).
   * @throws InvalidCredentialsShapeException when the shape is invalid.
   */
  validate(credentials: Record<string, unknown>): Promise<void>;
}
