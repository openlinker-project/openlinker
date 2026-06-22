/**
 * Subiekt Buyer Mapper (#753)
 *
 * Maps a neutral `BuyerProfile` to the bridge-native `BridgeBuyer`:
 *   - `name` 1:1
 *   - `nip` <- `taxId.value` ONLY when `taxId.scheme === 'pl-nip'`, else `null`
 *     (a non-PL tax id must not silently force a faktura)
 *   - `isCompany` <- `buyer.type === 'company'`
 *   - address 1:1 with the field-name divergence `countryIso2` -> `countryCode`
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { BuyerProfile } from '@openlinker/core/invoicing';
import type { BridgeBuyer } from '../../bridge/subiekt-bridge.types';
import { PL_NIP_SCHEME } from './subiekt-document-type.mapper';

export function toBridgeBuyer(buyer: BuyerProfile): BridgeBuyer {
  const taxId = buyer.taxId;
  const nip =
    taxId !== null && taxId.scheme === PL_NIP_SCHEME && taxId.value.length > 0
      ? taxId.value
      : null;

  return {
    name: buyer.name,
    nip,
    isCompany: buyer.type === 'company',
    address: {
      line1: buyer.address.line1,
      line2: buyer.address.line2,
      city: buyer.address.city,
      postalCode: buyer.address.postalCode,
      countryCode: buyer.address.countryIso2,
    },
  };
}
