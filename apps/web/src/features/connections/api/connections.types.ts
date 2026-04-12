export const PLATFORM_TYPES = ['prestashop', 'allegro'] as const;

export type PlatformType = (typeof PLATFORM_TYPES)[number];

export type ConnectionStatus = 'active' | 'disabled' | 'error';

export const CAPABILITY_VALUES = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
  'Marketplace',
] as const;

export type Capability = (typeof CAPABILITY_VALUES)[number];

export interface Connection {
  id: string;
  name: string;
  platformType: PlatformType;
  status: ConnectionStatus;
  config: Record<string, unknown>;
  credentialsRef: string;
  adapterKey?: string;
  enabledCapabilities: Capability[];
  supportedCapabilities: Capability[];
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionFilters {
  platformType?: PlatformType;
  status?: ConnectionStatus;
}

export interface CreateConnectionInput {
  name: string;
  platformType: PlatformType;
  config: Record<string, unknown>;
  credentialsRef: string;
  adapterKey?: string;
  enabledCapabilities?: Capability[];
}

export interface UpdateConnectionInput {
  name?: string;
  status?: ConnectionStatus;
  config?: Record<string, unknown>;
  adapterKey?: string;
  enabledCapabilities?: Capability[];
}

export interface RecentJobSummary {
  id: string;
  jobType: string;
  status: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

export interface ConnectionDiagnostics {
  connectionId: string;
  connectionName: string;
  connectionStatus: string;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  recentErrors: string[];
  recentJobs: RecentJobSummary[];
}
