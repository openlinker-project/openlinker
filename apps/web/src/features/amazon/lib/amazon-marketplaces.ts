/**
 * Amazon regions and marketplaces (#4186)
 *
 * The browser copy of `AMAZON_KNOWN_MARKETPLACES` and `AmazonRegionValues`
 * (`libs/integrations/amazon/src/amazon.constants.ts`); `apps/web` cannot
 * import the integration package. The backend stays the authority: it refuses
 * a marketplace served by another region on save, and this list only decides
 * what the form offers.
 *
 * @module features/amazon/lib
 */

export const AmazonRegionValues = ['eu', 'na', 'fe'] as const;
export type AmazonRegion = (typeof AmazonRegionValues)[number];

export const AmazonEnvironmentValues = ['production', 'sandbox'] as const;
export type AmazonEnvironment = (typeof AmazonEnvironmentValues)[number];

export interface AmazonMarketplace {
  readonly id: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
  readonly region: AmazonRegion;
  readonly currency: string;
}

/**
 * Every Amazon marketplace with its region and currency, mirroring
 * `AMAZON_KNOWN_MARKETPLACES` in `@openlinker/integrations-amazon` (the
 * browser cannot import it, #591). The API refuses a marketplace paired with
 * another region, so the form offers only the chosen region's.
 */
export const AMAZON_MARKETPLACES: readonly AmazonMarketplace[] = [
  { id: 'A2EUQ1WTGCTBG2', country: 'CA', region: 'na', currency: 'CAD' },
  { id: 'ATVPDKIKX0DER', country: 'US', region: 'na', currency: 'USD' },
  { id: 'A1AM78C64UM0Y8', country: 'MX', region: 'na', currency: 'MXN' },
  { id: 'A2Q3Y263D00KWC', country: 'BR', region: 'na', currency: 'BRL' },
  { id: 'A28R8C7NBKEWEA', country: 'IE', region: 'eu', currency: 'EUR' },
  { id: 'A1RKKUPIHCS9HS', country: 'ES', region: 'eu', currency: 'EUR' },
  { id: 'A1F83G8C2ARO7P', country: 'GB', region: 'eu', currency: 'GBP' },
  { id: 'A13V1IB3VIYZZH', country: 'FR', region: 'eu', currency: 'EUR' },
  { id: 'AMEN7PMS3EDWL', country: 'BE', region: 'eu', currency: 'EUR' },
  { id: 'A1805IZSGTT6HS', country: 'NL', region: 'eu', currency: 'EUR' },
  { id: 'A1PA6795UKMFR9', country: 'DE', region: 'eu', currency: 'EUR' },
  { id: 'APJ6JRA9NG5V4', country: 'IT', region: 'eu', currency: 'EUR' },
  { id: 'A2NODRKZP88ZB9', country: 'SE', region: 'eu', currency: 'SEK' },
  { id: 'AE08WJ6YKNBMC', country: 'ZA', region: 'eu', currency: 'ZAR' },
  { id: 'A1C3SOZRARQ6R3', country: 'PL', region: 'eu', currency: 'PLN' },
  { id: 'ARBP9OOSHTCHU', country: 'EG', region: 'eu', currency: 'EGP' },
  { id: 'A33AVAJ2PDY3EV', country: 'TR', region: 'eu', currency: 'TRY' },
  { id: 'A17E79C6D8DWNP', country: 'SA', region: 'eu', currency: 'SAR' },
  { id: 'A2VIGQ35RCS4UG', country: 'AE', region: 'eu', currency: 'AED' },
  { id: 'A21TJRUUN4KGV', country: 'IN', region: 'eu', currency: 'INR' },
  { id: 'A19VAU5U5O7RUS', country: 'SG', region: 'fe', currency: 'SGD' },
  { id: 'A39IBJ37TRP1C6', country: 'AU', region: 'fe', currency: 'AUD' },
  { id: 'A1VC38T7YXB528', country: 'JP', region: 'fe', currency: 'JPY' },
];

export function marketplacesForRegion(region: AmazonRegion): AmazonMarketplace[] {
  return AMAZON_MARKETPLACES.filter((marketplace) => marketplace.region === region);
}

export function findMarketplace(id: string): AmazonMarketplace | undefined {
  return AMAZON_MARKETPLACES.find((marketplace) => marketplace.id === id);
}

export function isAmazonRegion(value: unknown): value is AmazonRegion {
  return typeof value === 'string' && (AmazonRegionValues as readonly string[]).includes(value);
}
