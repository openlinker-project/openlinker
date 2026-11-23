/**
 * Mirakl GPSR Policy
 *
 * Turns a product's GPSR data (`Product.gpsr`, stated by the catalogue master)
 * into the offer additional fields Empik defines (AF01 on staging, entity
 * OFFER): `gpsr-*` for the responsible person and `gpsr-manufacturer-*` for
 * the producer. Every field is optional on Empik, so a missing value is left
 * out rather than sent empty. Nothing is invented: a product the master gave
 * no GPSR data sends none.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { GpsrParty, ProductGpsr } from '@openlinker/core/products';

export interface MiraklAdditionalFieldValue {
  readonly code: string;
  readonly value: string;
}

function partyFields(prefix: string, party: GpsrParty | undefined): MiraklAdditionalFieldValue[] {
  if (!party) {
    return [];
  }
  const values: Array<[string, string | undefined]> = [
    [`${prefix}entity-name`, party.name],
    [`${prefix}address`, party.address?.street],
    [`${prefix}city`, party.address?.city],
    [`${prefix}zip-code`, party.address?.postalCode],
    [`${prefix}country`, party.address?.countryCode],
    [`${prefix}email`, party.email],
    [`${prefix}phone`, party.phone],
  ];
  return values
    .filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''
    )
    .map(([code, value]) => ({ code, value: value.trim() }));
}

export function buildMiraklGpsrFields(gpsr: ProductGpsr | undefined): MiraklAdditionalFieldValue[] {
  if (!gpsr) {
    return [];
  }
  // Empik's responsible-person fields take the EU responsible person, else the
  // importer, the two GPSR roles that party can be.
  const responsible = gpsr.responsiblePerson ?? gpsr.importer;
  return [
    ...partyFields('gpsr-', responsible),
    ...partyFields('gpsr-manufacturer-', gpsr.producer),
  ];
}
