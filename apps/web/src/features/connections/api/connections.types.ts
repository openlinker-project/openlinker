export const PLATFORM_TYPES = ['prestashop', 'allegro'] as const;

export type PlatformType = (typeof PLATFORM_TYPES)[number];

export type ConnectionStatus = 'active' | 'disabled' | 'error';

export interface Connection {
  id: string;
  name: string;
  platformType: PlatformType;
  status: ConnectionStatus;
  config: Record<string, unknown>;
  credentialsRef: string;
  adapterKey?: string;
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
}

export interface UpdateConnectionInput {
  name?: string;
  status?: ConnectionStatus;
  config?: Record<string, unknown>;
  adapterKey?: string;
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
