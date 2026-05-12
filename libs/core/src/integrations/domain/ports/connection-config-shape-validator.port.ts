/**
 * Connection Config Shape Validator Port (#587)
 *
 * Contract for per-plugin validation of the `Connection.config` JSONB blob
 * submitted on connection create / update. Each plugin package registers an
 * adapter that implements this port via `host.connectionConfigShapeValidatorRegistry.register(adapterKey, …)`
 * in its `AdapterPlugin.register(host)` method.
 *
 * Replaces the pre-#587 static `CONNECTION_CONFIG_VALIDATORS: Record<platformType, fn>`
 * map that lived in `apps/api/src/integrations/application/services/util/`.
 * The registry is keyed by **adapterKey** (consistent with
 * `ConnectionTesterRegistryService` / `WebhookProvisioningRegistryService`):
 * a future second adapter for the same `platformType` (e.g.
 * `prestashop.graphql.v1` alongside `prestashop.webservice.v1`) can ship a
 * different config shape.
 *
 * Implementations throw `InvalidConnectionConfigException` (a core domain
 * exception) on shape failure. `ConnectionService` catches and maps to
 * `BadRequestException` at the API boundary — plugins never depend on
 * NestJS exception types via this port.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link ConnectionConfigShapeValidatorRegistryService} for the registry
 * @see {@link InvalidConnectionConfigException} for the failure exception
 */
export interface ConnectionConfigShapeValidatorPort {
  /**
   * Validate the raw `Connection.config` payload's shape.
   *
   * @param config - The JSONB blob from `CreateConnectionDto.config` or
   *   `UpdateConnectionDto.config`. May carry adjacent keys the plugin
   *   doesn't recognise — implementations should NOT reject on unknown
   *   keys (the persisted config can grow over time).
   * @throws InvalidConnectionConfigException when the shape is invalid.
   *   Other throws propagate as 500 — only the documented exception type
   *   maps to a 400 at the API boundary.
   */
  validate(config: Record<string, unknown>): Promise<void>;
}
