import { createAllegroApi, type AllegroApi } from '../../features/allegro/api/allegro.api';
import { createAdaptersApi, type AdaptersApi } from '../../features/adapters/api/adapters.api';
import { createConnectionsApi, type ConnectionsApi } from '../../features/connections/api/connections.api';
import { createSyncJobsApi, type SyncJobsApi } from '../../features/sync-jobs/api/sync.api';
import { ApiError } from '../../shared/api/api-error';
import type { SessionAdapter } from '../../shared/auth/session-adapter';

interface ApiClientConfig {
  baseUrl: string;
  fetchFn?: typeof fetch;
  sessionAdapter: SessionAdapter;
}

export interface ApiClient {
  adapters: AdaptersApi;
  allegro: AllegroApi;
  connections: ConnectionsApi;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  syncJobs: SyncJobsApi;
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json() as Promise<unknown>;
  }

  return response.text();
}

export function createApiClient({
  baseUrl,
  fetchFn = fetch,
  sessionAdapter,
}: ApiClientConfig): ApiClient {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const accessToken = await sessionAdapter.getAccessToken();
    const headers = new Headers(init.headers);

    headers.set('Accept', 'application/json');

    if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    if (accessToken !== null) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const response = await fetchFn(buildUrl(baseUrl, path), {
      ...init,
      headers,
    });
    const payload = await readResponseBody(response);

    if (!response.ok) {
      throw ApiError.fromResponse(response, payload);
    }

    return payload as T;
  };

  return {
    adapters: createAdaptersApi(request),
    allegro: createAllegroApi(request),
    connections: createConnectionsApi(request),
    request,
    syncJobs: createSyncJobsApi(request),
  };
}
