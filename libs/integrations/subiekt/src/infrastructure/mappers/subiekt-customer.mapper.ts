/**
 * Subiekt Customer Mapper (#753)
 *
 * Maps a neutral `BuyerProfile` to the bridge-native TOP-LEVEL upsert-customer
 * request (the bridge's `CreateFirmaRequestDto` — NOT wrapped in a `buyer`):
 *   - `nazwaSkrocona` <- `name`
 *   - `nip`           <- `taxId.value` ONLY when `taxId.scheme === 'pl-nip'`, else `null`
 *   - `typ`           <- `'firma'` when `buyer.type === 'company'`, else `'osoba'`
 *   - `address`       <- neutral `BuyerAddress` mapped onto the bridge's Polish
 *                        `AddressDto` (shared with the buyer mapper).
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { BuyerProfile } from '@openlinker/core/invoicing';
import type { BridgeUpsertCustomerRequest } from '../../bridge/subiekt-bridge.types';
import { toBridgeBuyer } from './subiekt-buyer.mapper';

export function toBridgeUpsertCustomerRequest(buyer: BuyerProfile): BridgeUpsertCustomerRequest {
  // Reuse the buyer mapper for the nip/address derivation, then reshape onto the
  // top-level customer request the bridge's upsert endpoint expects.
  const bridgeBuyer = toBridgeBuyer(buyer);
  return {
    nazwaSkrocona: bridgeBuyer.name,
    nip: bridgeBuyer.nip,
    typ: bridgeBuyer.isCompany ? 'firma' : 'osoba',
    address: bridgeBuyer.address,
  };
}
