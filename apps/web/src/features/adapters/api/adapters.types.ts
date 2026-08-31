export interface AdapterSummary {
  adapterKey: string;
  platformType: string;
  /**
   * Open string set — well-known values are `CoreCapability` (see
   * `connections.types.ts`); plugin adapters can register additional
   * capability names (#576).
   */
  supportedCapabilities: string[];
  displayName?: string;
  version?: string;
  /**
   * Whether this adapter is the platform's default — the one the backend
   * resolves via `getDefaultAdapterKey` when a create request omits
   * `adapterKey`, which the connection create form always does.
   */
  isDefault?: boolean;
  /**
   * Whether a connection for this adapter must carry credentials (#2405,
   * ADR-055). Absent means `true` — mirroring the backend's
   * `resolveRequiresCredentials` default, so an adapter that declares nothing
   * keeps the credential fields it always had.
   *
   * `GET /adapters` returns `AdapterMetadata` with no DTO projection, so this
   * arrives verbatim from the manifest.
   */
  requiresCredentials?: boolean;
}
