import type {
  ApproveUserInput,
  UserListFilters,
  UserListResponse,
} from './users.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface UsersApi {
  list: (filters?: UserListFilters) => Promise<UserListResponse>;
  approve: (userId: string, input: ApproveUserInput) => Promise<void>;
  reject: (userId: string) => Promise<void>;
  updateRole: (userId: string, input: { role: string }) => Promise<void>;
  deactivate: (userId: string) => Promise<void>;
  reactivate: (userId: string) => Promise<void>;
  delete: (userId: string) => Promise<void>;
}

function buildQuery(filters?: UserListFilters): string {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.page !== undefined) params.set('page', String(filters.page));
  if (filters?.pageSize !== undefined) params.set('pageSize', String(filters.pageSize));
  const q = params.toString();
  return q.length > 0 ? `?${q}` : '';
}

export function createUsersApi(request: ApiRequest): UsersApi {
  return {
    list(filters): Promise<UserListResponse> {
      return request<UserListResponse>(`/users${buildQuery(filters)}`);
    },
    approve(userId, input): Promise<void> {
      return request<void>(`/users/${userId}/approve`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    reject(userId): Promise<void> {
      return request<void>(`/users/${userId}/reject`, {
        method: 'POST',
      });
    },
    updateRole(userId, input): Promise<void> {
      return request<void>(`/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
    deactivate(userId): Promise<void> {
      return request<void>(`/users/${userId}/deactivate`, {
        method: 'POST',
      });
    },
    reactivate(userId): Promise<void> {
      return request<void>(`/users/${userId}/reactivate`, {
        method: 'POST',
      });
    },
    delete(userId): Promise<void> {
      return request<void>(`/users/${userId}`, {
        method: 'DELETE',
      });
    },
  };
}
