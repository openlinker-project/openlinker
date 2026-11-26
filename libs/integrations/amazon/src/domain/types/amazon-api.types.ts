/**
 * Amazon SP-API Wire Types
 *
 * The response shapes the foundation reads. Every SP-API error answers with
 * an `errors` array; LWA (the token endpoint) answers OAuth-style
 * `error` / `error_description`.
 *
 * @module libs/integrations/amazon/src/domain/types
 */

export interface AmazonSpApiErrorItem {
  readonly code?: string;
  readonly message?: string;
  readonly details?: string;
}

export interface AmazonSpApiErrorBody {
  readonly errors?: readonly AmazonSpApiErrorItem[];
}

export interface AmazonLwaTokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/** `GET /sellers/v1/marketplaceParticipations`. */
export interface AmazonMarketplaceParticipationsResponse {
  readonly payload?: readonly AmazonMarketplaceParticipation[];
}

export interface AmazonMarketplaceParticipation {
  readonly marketplace?: {
    readonly id?: string;
    readonly countryCode?: string;
    readonly name?: string;
  };
  readonly participation?: {
    readonly isParticipating?: boolean;
    readonly hasSuspendedListings?: boolean;
  };
  readonly storeName?: string;
}
