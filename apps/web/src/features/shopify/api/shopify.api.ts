/**
 * Shopify API namespace
 *
 * The two OAuth install calls (#3974). Creating a connection with app
 * credentials or an access token uses the ordinary connections API.
 *
 * @module features/shopify/api
 */
import type { ApiRequest } from '../../../app/api/api-client';

export interface StartShopifyOAuthInput {
  storeDomain: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  connectionName?: string;
  locationId?: string;
}

export interface StartShopifyOAuthResponse {
  authorizationUrl: string;
  state: string;
}

export interface ShopifyCallbackResponse {
  message: string;
  connectionId: string;
  connectionName: string;
}

export interface ShopifyApi {
  startOAuth: (input: StartShopifyOAuthInput) => Promise<StartShopifyOAuthResponse>;
  handleCallback: (rawQuery: string) => Promise<ShopifyCallbackResponse>;
}

export function createShopifyApi(request: ApiRequest): ShopifyApi {
  return {
    startOAuth: (input) =>
      request<StartShopifyOAuthResponse>('/integrations/shopify/oauth/connect', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    handleCallback: (rawQuery) =>
      request<ShopifyCallbackResponse>('/integrations/shopify/oauth/callback', {
        method: 'POST',
        body: JSON.stringify({ rawQuery }),
      }),
  };
}
