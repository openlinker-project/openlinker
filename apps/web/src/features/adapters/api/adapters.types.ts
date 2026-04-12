import type { Capability } from '../../connections/api/connections.types';

export interface AdapterSummary {
  adapterKey: string;
  platformType: string;
  supportedCapabilities: Capability[];
  displayName?: string;
  version?: string;
}
