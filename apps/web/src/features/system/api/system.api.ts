import type { ApiRequest } from '../../../app/api/api-client';
import type { SystemConfig } from './system.types';

export interface SystemApi {
  getConfig: () => Promise<SystemConfig>;
}

export function createSystemApi(request: ApiRequest): SystemApi {
  return {
    getConfig(): Promise<SystemConfig> {
      return request<SystemConfig>('/system/config');
    },
  };
}
