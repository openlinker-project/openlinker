import type { Connection, ConnectionFilters, CreateConnectionInput, UpdateConnectionInput } from './connections.types';

export interface ConnectionsApi {
  create: (input: CreateConnectionInput) => Promise<Connection>;
  getById: (connectionId: string) => Promise<Connection>;
  list: (filters?: ConnectionFilters) => Promise<Connection[]>;
  update: (connectionId: string, input: UpdateConnectionInput) => Promise<Connection>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: ConnectionFilters): string {
  const params = new URLSearchParams();

  if (filters?.platformType) {
    params.set('platformType', filters.platformType);
  }

  if (filters?.status) {
    params.set('status', filters.status);
  }

  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

export function createConnectionsApi(request: ApiRequest): ConnectionsApi {
  return {
    create(input) {
      return request<Connection>('/connections', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    getById(connectionId) {
      return request<Connection>(`/connections/${connectionId}`);
    },
    list(filters) {
      return request<Connection[]>(`/connections${buildQuery(filters)}`);
    },
    update(connectionId, input) {
      return request<Connection>(`/connections/${connectionId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
  };
}
