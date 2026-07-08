/**
 * Connection Credentials Rewriter Port (#1387, ADR-031)
 *
 * Contract for per-plugin transformation of a raw `credentials` payload
 * submitted on connection create / credential rotation, BEFORE it is merged
 * onto the existing stored blob and shape-validated. Distinct from
 * {@link ConnectionCredentialsShapeValidatorPort}: a validator only checks
 * shape and never mutates the payload, while a rewriter is free to replace,
 * add, or drop fields (e.g. resolving a caller-supplied reference into
 * concrete secret values fetched server-side).
 *
 * Each plugin registers an adapter via
 * `host.connectionCredentialsRewriterRegistry.register(adapterKey, …)` in
 * `AdapterPlugin.register(host)` (or, when the rewriter needs a dependency
 * outside the framework-neutral `HostServices` bag, from a companion NestJS
 * module that injects `CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN`
 * directly — mirroring the existing webhook-provisioner pattern). The
 * registry is keyed by **adapterKey** (consistent with the other host
 * registries).
 *
 * Implementations throw `ConnectionCredentialsRewriteException` (a core
 * domain exception) on failure. `ConnectionService` catches and maps to
 * `BadRequestException` at the API boundary.
 *
 * The port's contract is deliberately platform-neutral: it says nothing
 * about *what* a plugin rewrites — only that it may transform the incoming
 * payload before persistence. Any platform-specific field names or
 * semantics (e.g. "resolve a sibling Allegro connection's app credentials")
 * live entirely in the adapter implementation, never in this port.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link ConnectionCredentialsRewriterRegistryService} for the registry
 * @see {@link ConnectionCredentialsRewriteException} for the failure exception
 */
export interface ConnectionCredentialsRewriterPort {
  /**
   * Rewrite the raw credentials payload, returning the payload to actually
   * merge/persist. Implementations that don't need to change anything for a
   * given payload return it unchanged.
   *
   * @param credentials - The raw credential payload, exactly as the operator
   *   sent it.
   * @returns The (possibly transformed) credentials payload.
   * @throws ConnectionCredentialsRewriteException when the payload cannot be
   *   rewritten.
   */
  rewrite(credentials: Record<string, unknown>): Promise<Record<string, unknown>>;
}
