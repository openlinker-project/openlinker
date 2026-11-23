/**
 * Mirakl Connection Types
 *
 * Credentials and non-secret config for a connection to a Mirakl operator
 * (Empik, and later other Mirakl marketplaces). Mirakl authenticates a shop
 * with one static API key the seller generates in the operator's back office,
 * so the credentials carry only `apiKey`.
 *
 * The base URL is deliberately NOT a config field: it comes from the operator
 * profile, picked by `environment`, so a connection can never send its key to a
 * host the profile does not name.
 *
 * @module libs/integrations/mirakl/src/domain/types
 */

/**
 * Environments every Mirakl operator profile names. Empik calls its test
 * platform "staging" (`stg1.marketplace.empik.com`), hence the name.
 */
export const MiraklEnvironmentValues = ['production', 'staging'] as const;
export type MiraklEnvironment = (typeof MiraklEnvironmentValues)[number];

/** Encrypted credentials, resolved through `host.credentialsResolver`. */
export interface MiraklCredentials {
  /** Shop API key from the operator back office (user menu, "API key"). */
  apiKey: string;
}

/** Non-secret per-connection config stored on `connection.config`. */
export interface MiraklConnectionConfig {
  /** Which of the profile's base URLs to call. Absent means `production`. */
  environment?: MiraklEnvironment;
  /**
   * Shop id, sent as the `shop_id` query parameter. Needed only when one API
   * key has access to several shops; absent means the key's default shop.
   */
  shopId?: number | string;
}
