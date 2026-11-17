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

export const AMAZON_MARKETPLACES: readonly AmazonMarketplace[] = [
  { id: 'A1PA6795UKMFR9', country: 'DE', region: 'eu', currency: 'EUR' },
  { id: 'A13V1IB3VIYZZH', country: 'FR', region: 'eu', currency: 'EUR' },
  { id: 'A1C3SOZRARQ6R3', country: 'PL', region: 'eu', currency: 'PLN' },
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
