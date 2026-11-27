/**
 * Amazon Carrier Codes
 *
 * `confirmShipment` needs Amazon's own `carrierCode`. A label bought through an
 * OpenLinker carrier names that carrier's connection `platformType`
 * (`DispatchCarrierHint`); this table turns it into Amazon's code. Anything
 * not listed goes as `Other` with the carrier's name, which Amazon accepts but
 * may not track, so a carrier sellers use often belongs in the table.
 *
 * The code values are Amazon's published carrier names for these carriers;
 * confirm them on a live account when #4178 is verified (a wrong code is
 * accepted but hurts the seller's valid-tracking rate).
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/order-source
 */

export const AMAZON_OTHER_CARRIER_CODE = 'Other';

export const AMAZON_CARRIER_CODE_BY_PLATFORM_TYPE: Readonly<Record<string, string>> = {
  inpost: 'InPost',
  'dpd-polska': 'DPD',
};

export function resolveAmazonCarrier(platformType: string | undefined): {
  readonly carrierCode: string;
  readonly carrierName?: string;
} {
  const known = platformType ? AMAZON_CARRIER_CODE_BY_PLATFORM_TYPE[platformType] : undefined;
  if (known !== undefined) {
    return { carrierCode: known };
  }
  return { carrierCode: AMAZON_OTHER_CARRIER_CODE, carrierName: platformType ?? 'Carrier' };
}
