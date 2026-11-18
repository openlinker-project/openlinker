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
 * Every SP-API marketplace, with the region whose host serves it, the
 * currency it sells in and the language of its listings (Amazon's marketplace
 * id table). Listings and Catalog refuse a marketplace from another region
 * (`"... not valid for region"`, #2881 Evidence #5), so the config validator
 * checks the pairing; a price read from a marketplace is stored in that
 * marketplace's currency. An id not listed here (a marketplace Amazon opens
 * later) is accepted by format alone.
 */
export const AMAZON_KNOWN_MARKETPLACES: Readonly<
  Record<
    string,
    {
      readonly country: string;
      readonly region: AmazonRegion;
      readonly currency: string;
      /** The language text attributes of a listing are written in (`language_tag`, #4181). */
      readonly languageTag: string;
    }
  >
> = {
  // North America
  A2EUQ1WTGCTBG2: { country: 'CA', region: 'na', currency: 'CAD', languageTag: 'en_CA' },
  ATVPDKIKX0DER: { country: 'US', region: 'na', currency: 'USD', languageTag: 'en_US' },
  A1AM78C64UM0Y8: { country: 'MX', region: 'na', currency: 'MXN', languageTag: 'es_MX' },
  A2Q3Y263D00KWC: { country: 'BR', region: 'na', currency: 'BRL', languageTag: 'pt_BR' },
  // Europe, Middle East, Africa, India
  A28R8C7NBKEWEA: { country: 'IE', region: 'eu', currency: 'EUR', languageTag: 'en_IE' },
  A1RKKUPIHCS9HS: { country: 'ES', region: 'eu', currency: 'EUR', languageTag: 'es_ES' },
  A1F83G8C2ARO7P: { country: 'GB', region: 'eu', currency: 'GBP', languageTag: 'en_GB' },
  A13V1IB3VIYZZH: { country: 'FR', region: 'eu', currency: 'EUR', languageTag: 'fr_FR' },
  AMEN7PMS3EDWL: { country: 'BE', region: 'eu', currency: 'EUR', languageTag: 'fr_BE' },
  A1805IZSGTT6HS: { country: 'NL', region: 'eu', currency: 'EUR', languageTag: 'nl_NL' },
  A1PA6795UKMFR9: { country: 'DE', region: 'eu', currency: 'EUR', languageTag: 'de_DE' },
  APJ6JRA9NG5V4: { country: 'IT', region: 'eu', currency: 'EUR', languageTag: 'it_IT' },
  A2NODRKZP88ZB9: { country: 'SE', region: 'eu', currency: 'SEK', languageTag: 'sv_SE' },
  AE08WJ6YKNBMC: { country: 'ZA', region: 'eu', currency: 'ZAR', languageTag: 'en_ZA' },
  A1C3SOZRARQ6R3: { country: 'PL', region: 'eu', currency: 'PLN', languageTag: 'pl_PL' },
  ARBP9OOSHTCHU: { country: 'EG', region: 'eu', currency: 'EGP', languageTag: 'en_AE' },
  A33AVAJ2PDY3EV: { country: 'TR', region: 'eu', currency: 'TRY', languageTag: 'tr_TR' },
  A17E79C6D8DWNP: { country: 'SA', region: 'eu', currency: 'SAR', languageTag: 'en_AE' },
  A2VIGQ35RCS4UG: { country: 'AE', region: 'eu', currency: 'AED', languageTag: 'en_AE' },
  A21TJRUUN4KGV: { country: 'IN', region: 'eu', currency: 'INR', languageTag: 'en_IN' },
  // Far East
  A19VAU5U5O7RUS: { country: 'SG', region: 'fe', currency: 'SGD', languageTag: 'en_SG' },
  A39IBJ37TRP1C6: { country: 'AU', region: 'fe', currency: 'AUD', languageTag: 'en_AU' },
  A1VC38T7YXB528: { country: 'JP', region: 'fe', currency: 'JPY', languageTag: 'ja_JP' },
};

/** Probe used by the connection tester; needs no role beyond the app's base access. */
export const AMAZON_MARKETPLACE_PARTICIPATIONS_PATH = '/sellers/v1/marketplaceParticipations';

/**
 * Sent on every SP-API call, as Amazon asks of integrators
 * (`AppName/Version (Language=...)`). Carries no deployment detail.
 */
export const AMAZON_USER_AGENT = 'OpenLinker/0.1 (Language=TypeScript)';

/** Grantless LWA scope the Notifications API's destination calls need (#4179). */
export const AMAZON_NOTIFICATIONS_GRANTLESS_SCOPE = 'sellingpartnerapi::notifications';
