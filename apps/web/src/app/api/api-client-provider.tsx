import { createContext, useContext, type PropsWithChildren } from 'react';
import type { ApiClient } from './api-client';

const ApiClientContext = createContext<ApiClient | null>(null);

interface ApiClientProviderProps extends PropsWithChildren {
  client: ApiClient;
}

export function ApiClientProvider({ client, children }: ApiClientProviderProps) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient() {
  const context = useContext(ApiClientContext);

  if (context === null) {
    throw new Error('useApiClient must be used within an ApiClientProvider');
  }

  return context;
}
