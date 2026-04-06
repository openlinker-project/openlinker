import type { DevStackHealth } from './health.types';

export interface HealthApi {
  getDevStackHealth: () => Promise<DevStackHealth>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createHealthApi(request: ApiRequest): HealthApi {
  return {
    getDevStackHealth: () => request<DevStackHealth>('/health/dev-stack'),
  };
}
