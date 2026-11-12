/**
 * Shopify Tracking Mapper
 *
 * The `trackingInfo` of a fulfillment. The URL is ALWAYS sent: given a number
 * and no URL, Shopify guesses the carrier from the number and stored a FedEx
 * link for an InPost parcel (live, L-F3). Known carriers get their own tracking
 * page; an unknown one gets a carrier-neutral tracking lookup rather than
 * nothing, because "nothing" is exactly what makes Shopify guess.
 *
 * The carrier comes from the dispatch event's neutral `DispatchCarrierHint`
 * (`platformType` of the shipping connection that bought the label).
 *
 * @module libs/integrations/shopify/src/infrastructure/mappers
 */

export interface ShopifyTrackingInfo {
  readonly number: string;
  readonly company: string;
  readonly url: string;
}

const CARRIERS: Readonly<Record<string, { company: string; url: (n: string) => string }>> = {
  inpost: {
    company: 'InPost',
    url: (n) => `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(n)}`,
  },
  dpd: {
    company: 'DPD',
    url: (n) => `https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=${encodeURIComponent(n)}`,
  },
};

export function buildShopifyTrackingInfo(
  trackingNumber: string,
  carrierPlatformType: string | undefined,
): ShopifyTrackingInfo {
  const number = trackingNumber.trim();
  const known = carrierPlatformType === undefined ? undefined : CARRIERS[carrierPlatformType];
  if (known !== undefined) {
    return { number, company: known.company, url: known.url(number) };
  }
  return {
    number,
    company: 'Other',
    url: `https://parcelsapp.com/en/tracking/${encodeURIComponent(number)}`,
  };
}
