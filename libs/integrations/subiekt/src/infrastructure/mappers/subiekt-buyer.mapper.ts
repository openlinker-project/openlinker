/**
 * Subiekt Buyer Mapper (#753)
 *
 * Maps a neutral `BuyerProfile` to the bridge-native `BridgeBuyer` (the bridge's
 * inline `BuyerDto`):
 *   - `name` 1:1
 *   - `nip` <- `taxId.value` ONLY when `taxId.scheme === 'pl-nip'`, else `null`
 *     (a non-PL tax id must not silently force a faktura)
 *   - `isCompany` <- `buyer.type === 'company'`
 *   - `address` <- neutral `BuyerAddress` mapped onto the bridge's Polish
 *     `AddressDto` (`line1`->`ulica`, `line2`->`nrLokalu`, `city`->`miejscowosc`,
 *     `postalCode`->`kodPocztowy`, `countryIso2`->`countryCode`). The neutral
 *     shape has no separate house-number field, so the full `line1` goes to
 *     `ulica` (matching the bridge's "street + number" interpretation).
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { BuyerProfile } from '@openlinker/core/invoicing';
import type { BridgeAddress, BridgeBuyer } from '../../bridge/subiekt-bridge.types';
import { PL_NIP_SCHEME } from './subiekt-document-type.mapper';

function toBridgeAddress(address: BuyerProfile['address']): BridgeAddress {
  return {
    // The neutral address has no discrete house-number field; the bridge's
    // `ulica` is documented as "street + number", so map the full line1 there.
    ulica: address.line1,
    nrLokalu: address.line2,
    kodPocztowy: address.postalCode,
    miejscowosc: address.city,
    countryCode: address.countryIso2,
  };
}

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
    address: toBridgeAddress(buyer.address),
  };
}
