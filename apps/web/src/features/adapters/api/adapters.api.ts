export interface AdapterSummary {
  key: string;
  provider: string;
  capabilities: string[];
}

export interface AdaptersApi {
  list: () => Promise<AdapterSummary[]>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createAdaptersApi(request: ApiRequest): AdaptersApi {
  return {
    list() {
      return request<AdapterSummary[]>('/adapters');
    },
  };
}
