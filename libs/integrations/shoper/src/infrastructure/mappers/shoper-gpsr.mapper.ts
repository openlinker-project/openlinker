/**
 * Shoper GPSR Mapper
 *
 * Pure mapping from Shoper's GPSR model - id references on the product
 * (`safety_information`) into four registries - to the neutral `ProductGpsr`.
 * Fetching the registries is `ShoperGpsrReader`'s job; this file decides what
 * the references mean and how a record becomes a neutral party.
 *
 * Two rules carry the weight:
 *   - A reference that cannot be resolved makes the WHOLE answer unknown, never
 *     a partial one. A product whose producer record is missing is not "a
 *     product without a producer", and writing it as such would overwrite a
 *     correct stored declaration.
 *   - Nothing is invented. A record with no public `name` is unreadable (the
 *     merchant's `internal_name` is a label, not a party), an address field
 *     that is not what it claims to be is dropped, and certificate descriptions
 *     are NOT turned into safety text: they describe the certificate, not the
 *     product's warnings.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { GpsrAddress, GpsrParty, ProductGpsr } from '@openlinker/core/products';

import type {
  ShoperProductSafetyInformation,
  ShoperSafetyCertificateRecord,
  ShoperSafetyPartyRecord,
} from '../../domain/types/shoper-api.types';

/** The ids a product's `safety_information` names, normalised. */
export interface ShoperGpsrReferences {
  readonly producerId: string | null;
  readonly responsibleId: string | null;
  readonly importerId: string | null;
  readonly certificateIds: readonly string[];
}

/** The registries a set of references is resolved against, keyed by id. */
export interface ShoperGpsrTables {
  readonly producers?: ReadonlyMap<string, ShoperSafetyPartyRecord>;
  readonly responsibles?: ReadonlyMap<string, ShoperSafetyPartyRecord>;
  readonly importers?: ReadonlyMap<string, ShoperSafetyPartyRecord>;
  readonly certificates?: ReadonlyMap<string, ShoperSafetyCertificateRecord>;
}

/** The outcome of resolving references against the registries. */
export type ShoperGpsrResolution =
  | { readonly kind: 'resolved'; readonly gpsr: ProductGpsr }
  | { readonly kind: 'unresolvable'; readonly detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A registry id, or null when unset. `'0'` is read as unset too: Shoper ids
 * start at 1, so a zero can only be a "none" written by a client that does not
 * send null - assumed, not seen live.
 */
export function shoperGpsrId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  const raw = text(value);
  return raw !== undefined && /^\d+$/.test(raw) && raw !== '0' ? String(Number(raw)) : null;
}

/**
 * The references a product carries:
 *   - `undefined` - the payload has no `safety_information` at all (the shop
 *     did not report it, so nothing can be said);
 *   - `null` - it has one and every reference in it is empty (the shop says
 *     the product carries no GPSR data);
 *   - the normalised ids otherwise.
 */
export function readShoperGpsrReferences(info: unknown): ShoperGpsrReferences | null | undefined {
  if (!isRecord(info)) return undefined;
  const typed = info as ShoperProductSafetyInformation;
  const certificateIds = Array.isArray(typed.gpsr_certificates)
    ? [...new Set(typed.gpsr_certificates.map(shoperGpsrId).filter((id): id is string => id !== null))]
    : [];
  const refs: ShoperGpsrReferences = {
    producerId: shoperGpsrId(typed.gpsr_producer_id),
    responsibleId: shoperGpsrId(typed.gpsr_responsible_id),
    importerId: shoperGpsrId(typed.gpsr_importer_id),
    certificateIds,
  };
  const empty =
    refs.producerId === null &&
    refs.responsibleId === null &&
    refs.importerId === null &&
    certificateIds.length === 0;
  return empty ? null : refs;
}

function mapAddress(record: ShoperSafetyPartyRecord): GpsrAddress | undefined {
  const address: GpsrAddress = {};
  const street = [text(record.street1), text(record.street2)]
    .filter((line): line is string => line !== undefined)
    .join(', ');
  if (street.length > 0) address.street = street;
  const postalCode = text(record.postcode);
  if (postalCode) address.postalCode = postalCode;
  // The schema allows a GeolocationSubregion id here instead of a name; a bare
  // number is an id, and printing it as a town would be a false address.
  const city = text(record.city);
  if (city && !/^\d+$/.test(city)) address.city = city;
  const country = text(record.country_code);
  if (country && /^[A-Za-z]{2}$/.test(country)) address.countryCode = country.toUpperCase();
  return Object.keys(address).length > 0 ? address : undefined;
}

/** A registry record as a neutral party, or null when it has no public name. */
export function mapShoperGpsrParty(record: ShoperSafetyPartyRecord): GpsrParty | null {
  const name = text(record.name);
  if (!name) return null;
  const party: GpsrParty = { name };
  const email = text(record.email);
  const phone = text(record.phone);
  const contactUrl = text(record.contact_form_url);
  const address = mapAddress(record);
  if (email) party.email = email;
  if (phone) party.phone = phone;
  if (contactUrl) party.contactUrl = contactUrl;
  if (address) party.address = address;
  return party;
}

function resolveParty(
  role: string,
  id: string | null,
  table: ReadonlyMap<string, ShoperSafetyPartyRecord> | undefined,
): GpsrParty | null | string {
  if (id === null) return null;
  const record = table?.get(id);
  if (record === undefined) return `${role} ${id} is not in the shop's registry`;
  const party = mapShoperGpsrParty(record);
  return party ?? `${role} ${id} has no public name`;
}

/**
 * Resolve references against the registries. Any reference that cannot be
 * turned into a named record makes the answer `unresolvable`, with the reason.
 */
export function buildShoperGpsr(
  refs: ShoperGpsrReferences,
  tables: ShoperGpsrTables,
): ShoperGpsrResolution {
  const gpsr: ProductGpsr = {};
  const parties: Array<[keyof Pick<ProductGpsr, 'producer' | 'responsiblePerson' | 'importer'>, GpsrParty | null | string]> = [
    ['producer', resolveParty('producer', refs.producerId, tables.producers)],
    ['responsiblePerson', resolveParty('responsible person', refs.responsibleId, tables.responsibles)],
    ['importer', resolveParty('importer', refs.importerId, tables.importers)],
  ];
  for (const [field, outcome] of parties) {
    if (typeof outcome === 'string') return { kind: 'unresolvable', detail: outcome };
    if (outcome !== null) gpsr[field] = outcome;
  }

  const certificateNames: string[] = [];
  for (const id of refs.certificateIds) {
    const record = tables.certificates?.get(id);
    if (record === undefined) {
      return { kind: 'unresolvable', detail: `certificate ${id} is not in the shop's registry` };
    }
    const name = text(record.name);
    if (!name) return { kind: 'unresolvable', detail: `certificate ${id} has no name` };
    certificateNames.push(name);
  }
  if (certificateNames.length > 0) {
    gpsr.safetyInformation = { certificateNames };
  }
  return { kind: 'resolved', gpsr };
}
