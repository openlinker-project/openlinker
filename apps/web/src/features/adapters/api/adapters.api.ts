import type { AdapterSummary } from './adapters.types';

export interface AdaptersApi {
  list: () => Promise<AdapterSummary[]>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createAdaptersApi(request: ApiRequest): AdaptersApi {
  return {
    list(): Promise<AdapterSummary[]> {
      return request<AdapterSummary[]>('/adapters');
    },
  };
}
