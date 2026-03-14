export type ConnectionStatus = 'active' | 'disabled' | 'error';

export interface Connection {
  id: string;
  name: string;
  platformType: string;
  status: ConnectionStatus;
  config: Record<string, unknown>;
  credentialsRef: string;
  adapterKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionFilters {
  platformType?: string;
  status?: ConnectionStatus;
}

export interface CreateConnectionInput {
  name: string;
  platformType: string;
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
