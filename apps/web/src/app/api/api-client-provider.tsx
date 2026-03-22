import { createContext, useContext, type PropsWithChildren, type ReactElement } from 'react';
import type { ApiClient } from './api-client';

const ApiClientContext = createContext<ApiClient | null>(null);

interface ApiClientProviderProps extends PropsWithChildren {
  client: ApiClient;
}

export function ApiClientProvider({ client, children }: ApiClientProviderProps): ReactElement {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const context = useContext(ApiClientContext);

  if (context === null) {
    throw new Error('useApiClient must be used within an ApiClientProvider');
  }

  return context;
}
