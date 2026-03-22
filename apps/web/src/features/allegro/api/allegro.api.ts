export interface StartAllegroOAuthInput {
  redirectUri: string;
  environment?: 'sandbox' | 'production';
  connectionName?: string;
}

export interface StartAllegroOAuthResponse {
  authorizationUrl: string;
  state: string;
}

export interface AllegroApi {
  startOAuth: (input: StartAllegroOAuthInput) => Promise<StartAllegroOAuthResponse>;
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
  };
}
