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
}
