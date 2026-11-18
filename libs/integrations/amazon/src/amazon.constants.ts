/**
 * Amazon Constants
 *
 * Identity of the Amazon plugin and the facts about the Selling Partner API
 * (SP-API) that more than one file needs, kept in one place so the manifest,
 * the token provider, the tester and the validators cannot drift apart.
 *
 * Facts carried from the #2881 spike (`docs/plans/analysis/SPIKE-2881-amazon-sp-api.md`):
 * one Login with Amazon (LWA) token endpoint for every region, three regional
 * API hosts, and a static sandbox per region that answers from canned fixtures.
 *
 * @module libs/integrations/amazon/src
 */

export const AMAZON_ADAPTER_KEY = 'amazon.spapi.v1';
export const AMAZON_PLATFORM_TYPE = 'amazon';
export const AMAZON_BRAND = 'Amazon';

/** LWA token endpoint. One host for every region (#2881). */
export const AMAZON_LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

export const AmazonRegionValues = ['eu', 'na', 'fe'] as const;
export type AmazonRegion = (typeof AmazonRegionValues)[number];

export const AmazonEnvironmentValues = ['production', 'sandbox'] as const;
export type AmazonEnvironment = (typeof AmazonEnvironmentValues)[number];

/** Region used when the connection names none: the FR / DE / PL markets are all in `eu`. */
export const AMAZON_DEFAULT_REGION: AmazonRegion = 'eu';

/** SP-API hosts per region and environment. */
export const AMAZON_SPAPI_HOSTS: Readonly<Record<AmazonEnvironment, Readonly<Record<AmazonRegion, string>>>> = {
  production: {
    eu: 'sellingpartnerapi-eu.amazon.com',
    na: 'sellingpartnerapi-na.amazon.com',
    fe: 'sellingpartnerapi-fe.amazon.com',
  },
  sandbox: {
    eu: 'sandbox.sellingpartnerapi-eu.amazon.com',
    na: 'sandbox.sellingpartnerapi-na.amazon.com',
    fe: 'sandbox.sellingpartnerapi-fe.amazon.com',
  },
};

/**
 * Marketplaces the first release targets (#3741), with the region whose host
 * serves them. Listings and Catalog refuse a marketplace from another region
 * (`"... not valid for region"`, #2881 Evidence #5), so the config validator
 * checks the pairing for the ids it knows. An id not listed here is accepted
 * by format alone: the list names what we target, not every Amazon market.
 */
export const AMAZON_KNOWN_MARKETPLACES: Readonly<
  Record<string, { readonly country: string; readonly region: AmazonRegion }>
> = {
  A13V1IB3VIYZZH: { country: 'FR', region: 'eu' },
  A1PA6795UKMFR9: { country: 'DE', region: 'eu' },
  A1C3SOZRARQ6R3: { country: 'PL', region: 'eu' },
};

/** Probe used by the connection tester; needs no role beyond the app's base access. */
export const AMAZON_MARKETPLACE_PARTICIPATIONS_PATH = '/sellers/v1/marketplaceParticipations';

/**
 * Sent on every SP-API call, as Amazon asks of integrators
 * (`AppName/Version (Language=...)`). Carries no deployment detail.
 */
export const AMAZON_USER_AGENT = 'OpenLinker/0.1 (Language=TypeScript)';
