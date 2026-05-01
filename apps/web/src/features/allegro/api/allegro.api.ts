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

/**
 * Result of `POST /integrations/allegro/connections/:id/safety-attachments`.
 * Only `id` is referenced by Allegro on offer create; the remaining
 * fields are echoed for the wizard's attachment list rendering.
 */
export interface AllegroSafetyAttachmentUploadResponse {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AllegroApi {
  startOAuth: (input: StartAllegroOAuthInput) => Promise<StartAllegroOAuthResponse>;
  handleCallback: (code: string, state: string) => Promise<AllegroCallbackResponse>;
  listResponsibleProducers: (connectionId: string) => Promise<AllegroResponsibleProducer[]>;
  uploadSafetyAttachment: (
    connectionId: string,
    file: File,
  ) => Promise<AllegroSafetyAttachmentUploadResponse>;
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

    uploadSafetyAttachment(connectionId, file): Promise<AllegroSafetyAttachmentUploadResponse> {
      const formData = new FormData();
      formData.append('file', file, file.name);
      return request<AllegroSafetyAttachmentUploadResponse>(
        `/integrations/allegro/connections/${connectionId}/safety-attachments`,
        {
          method: 'POST',
          body: formData,
        },
      );
    },
  };
}
