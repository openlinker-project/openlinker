export interface StartAllegroOAuthInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment?: 'sandbox' | 'production';
  connectionName?: string;
  masterCatalogConnectionId?: string;
}

export interface StartAllegroOAuthResponse {
  authorizationUrl: string;
  state: string;
}

export interface AllegroCallbackResponse {
  message: string;
  connectionId: string;
  connectionName: string;
}

/**
 * One entry from `GET /integrations/allegro/connections/:id/responsible-producers`.
 * Mirrors the BE neutral `ResponsibleProducerEntry` shape so the FE Select
 * can render directly from the API response.
 */
export interface AllegroResponsibleProducer {
  id: string;
  name: string;
  kind:
    | 'PRODUCER'
    | 'IMPORTER'
    | 'AUTHORIZED_REPRESENTATIVE'
    | 'FULFILLMENT_SERVICE_PROVIDER';
}

export interface AllegroApi {
  startOAuth: (input: StartAllegroOAuthInput) => Promise<StartAllegroOAuthResponse>;
  handleCallback: (code: string, state: string) => Promise<AllegroCallbackResponse>;
  listResponsibleProducers: (connectionId: string) => Promise<AllegroResponsibleProducer[]>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createAllegroApi(request: ApiRequest): AllegroApi {
  return {
    startOAuth(input): Promise<StartAllegroOAuthResponse> {
      return request<StartAllegroOAuthResponse>('/integrations/allegro/oauth/connect', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    handleCallback(code, state): Promise<AllegroCallbackResponse> {
      const params = new URLSearchParams({ code, state });
      return request<AllegroCallbackResponse>(`/integrations/allegro/oauth/callback?${params.toString()}`);
    },

    listResponsibleProducers(connectionId): Promise<AllegroResponsibleProducer[]> {
      return request<AllegroResponsibleProducer[]>(
        `/integrations/allegro/connections/${connectionId}/responsible-producers`,
      );
    },
  };
}
