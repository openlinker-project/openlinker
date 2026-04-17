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

export interface AllegroApi {
  startOAuth: (input: StartAllegroOAuthInput) => Promise<StartAllegroOAuthResponse>;
  handleCallback: (code: string, state: string) => Promise<AllegroCallbackResponse>;
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
  };
}
