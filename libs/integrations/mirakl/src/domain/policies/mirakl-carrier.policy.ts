/**
 * Mirakl Carrier Policy
 *
 * Turns the neutral carrier hint on a `dispatched` event (the shipping
 * connection's `platformType`, e.g. `inpost`) into what OR23 takes: a carrier
 * code from the operator's SH21 list, or a free-text carrier name.
 *
 * The code comes from, in order:
 *
 * 1. The connection's `carrierCodes` override (`platformType` -> SH21 code),
 *    for an operator whose list differs or a carrier this table lacks.
 * 2. The built-in table below, read from Empik's SH21 on staging. InPost has
 *    two codes on Empik: a parcel-locker order (`PACKSTATION*` shipping type)
 *    goes as `paczkomatyinpost`, anything else as `inpostpaczkakurierska`.
 *
 * With no code the carrier is sent by name, which Mirakl accepts for a carrier
 * it does not list. A code Mirakl refuses is retried once by name (see
 * `MiraklOrderStatusWriter`), so a wrong code never keeps an order unshipped. With no hint at all the name is the generic `Carrier`, the
 * same fallback the Allegro writeback uses.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { MiraklTrackingBody } from '../types/mirakl-order.types';

/** SH21 codes on Empik for the shipping integrations OpenLinker ships. */
const DEFAULT_CARRIER_CODES: Readonly<Record<string, string>> = {
  dpd: 'dpd',
  dhl: 'dhl',
  gls: 'gls',
  ups: 'ups',
  fedex: 'fedex',
  pocztex: 'pocztex',
  'poczta-polska': 'pocztex',
  orlen: 'ORLEN',
};

const INPOST_LOCKER_CODE = 'paczkomatyinpost';
const INPOST_COURIER_CODE = 'inpostpaczkakurierska';
const LOCKER_SHIPPING_TYPE_PREFIX = 'PACKSTATION';
const UNKNOWN_CARRIER_NAME = 'Carrier';

export interface MiraklCarrierInput {
  /** The shipping connection's `platformType`, when the relay knows it. */
  readonly platformType?: string;
  /** The order's SH12 shipping type, to tell an InPost locker from a courier. */
  readonly shippingTypeCode?: string;
  /** The connection's `carrierCodes` override. */
  readonly overrides?: Readonly<Record<string, string>>;
}

export function resolveMiraklCarrierCode(input: MiraklCarrierInput): string | undefined {
  const platformType = input.platformType?.trim().toLowerCase();
  if (!platformType) return undefined;
  const override = input.overrides?.[platformType];
  if (override) return override;
  if (platformType === 'inpost') {
    return input.shippingTypeCode?.startsWith(LOCKER_SHIPPING_TYPE_PREFIX)
      ? INPOST_LOCKER_CODE
      : INPOST_COURIER_CODE;
  }
  return DEFAULT_CARRIER_CODES[platformType];
}

/** The OR23 body for one tracking number. */
export function buildMiraklTrackingBody(
  trackingNumber: string,
  input: MiraklCarrierInput
): MiraklTrackingBody {
  const code = resolveMiraklCarrierCode(input);
  if (code) {
    return { carrier_code: code, tracking_number: trackingNumber };
  }
  return buildMiraklTrackingBodyByName(trackingNumber, input.platformType);
}

/**
 * The OR23 body naming the carrier instead of coding it. Also the fallback
 * when Mirakl refuses a carrier code, so a wrong code never blocks shipping.
 */
export function buildMiraklTrackingBodyByName(
  trackingNumber: string,
  platformType: string | undefined
): MiraklTrackingBody {
  return {
    carrier_name: platformType?.trim() || UNKNOWN_CARRIER_NAME,
    tracking_number: trackingNumber,
  };
}
