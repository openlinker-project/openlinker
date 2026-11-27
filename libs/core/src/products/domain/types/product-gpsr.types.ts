/**
 * Product GPSR Types
 *
 * The neutral shape of what a ProductMaster states about a product under the EU
 * General Product Safety Regulation (2023/988): who made it, who answers for it
 * in the EU, who imported it, and what safety information travels with it.
 *
 * Carried by value, never by a platform id. A Shoper producer id or an Allegro
 * responsible-producer id means nothing outside its own platform, so each party
 * is described by the facts a destination can match or print (its name, its
 * contact, its address) and the destination adapter decides how to express it.
 *
 * Absence is meaningful at every level: a missing party, field or the whole
 * object means the master asserted nothing about it. Nothing here is ever
 * defaulted or derived, because a fabricated producer on a safety declaration
 * is a false legal statement rather than a cosmetic gap.
 *
 * `readProductGpsr` is the pure-rule exception (engineering-standards): it is
 * the coercion for this type, applied where an untyped value (a jsonb column)
 * becomes one, and it changes whenever the shape does.
 *
 * @module libs/core/src/products/domain/types
 */

/** A postal address as the master stated it. Every field is optional. */
export interface GpsrAddress {
  /** Street and number, as one line (a master's two lines are joined). */
  street?: string;
  postalCode?: string;
  city?: string;
  /** ISO 3166-1 alpha-2, upper case, when the master stated one. */
  countryCode?: string;
}

/**
 * One GPSR party - producer, EU responsible person or importer.
 *
 * `name` is the only required field: a party with no name identifies nobody,
 * so a master that cannot name one reports no party at all.
 */
export interface GpsrParty {
  name: string;
  email?: string;
  phone?: string;
  /** A contact-form URL the party publishes instead of, or beside, an email. */
  contactUrl?: string;
  address?: GpsrAddress;
}

/** Safety information that travels with the product. */
export interface GpsrSafetyInformation {
  /** Free-text warnings / instructions for the buyer. */
  text?: string;
  /** Names of the certificates the master links to the product. */
  certificateNames?: readonly string[];
}

/**
 * Everything a master stated about a product's GPSR data.
 *
 * On `Product.gpsr` the field carries three states, which persistence keeps
 * apart: `undefined` means the master did not report GPSR this pass (it does
 * not model it, or its reference read failed), `null` means it reported that
 * the product carries none, and an object is what it stated.
 */
export interface ProductGpsr {
  producer?: GpsrParty;
  responsiblePerson?: GpsrParty;
  importer?: GpsrParty;
  safetyInformation?: GpsrSafetyInformation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readAddress(value: unknown): GpsrAddress | undefined {
  if (!isRecord(value)) return undefined;
  const address: GpsrAddress = {};
  const street = readString(value.street);
  const postalCode = readString(value.postalCode);
  const city = readString(value.city);
  const countryCode = readString(value.countryCode);
  if (street) address.street = street;
  if (postalCode) address.postalCode = postalCode;
  if (city) address.city = city;
  if (countryCode) address.countryCode = countryCode;
  return Object.keys(address).length > 0 ? address : undefined;
}

function readParty(value: unknown): GpsrParty | undefined {
  if (!isRecord(value)) return undefined;
  const name = readString(value.name);
  if (!name) return undefined;
  const party: GpsrParty = { name };
  const email = readString(value.email);
  const phone = readString(value.phone);
  const contactUrl = readString(value.contactUrl);
  const address = readAddress(value.address);
  if (email) party.email = email;
  if (phone) party.phone = phone;
  if (contactUrl) party.contactUrl = contactUrl;
  if (address) party.address = address;
  return party;
}

function readSafetyInformation(value: unknown): GpsrSafetyInformation | undefined {
  if (!isRecord(value)) return undefined;
  const info: GpsrSafetyInformation = {};
  const text = readString(value.text);
  if (text) info.text = text;
  if (Array.isArray(value.certificateNames)) {
    const names = value.certificateNames
      .map(readString)
      .filter((name): name is string => name !== undefined);
    if (names.length > 0) info.certificateNames = names;
  }
  return Object.keys(info).length > 0 ? info : undefined;
}

/**
 * Coerce an untyped value into a `ProductGpsr`, or `null` when nothing in it is
 * readable. Malformed parts are DROPPED rather than repaired: a nameless party
 * disappears instead of being given a placeholder name, so a consumer can never
 * read a party the master did not actually name.
 */
export function readProductGpsr(value: unknown): ProductGpsr | null {
  if (!isRecord(value)) return null;
  const gpsr: ProductGpsr = {};
  const producer = readParty(value.producer);
  const responsiblePerson = readParty(value.responsiblePerson);
  const importer = readParty(value.importer);
  const safetyInformation = readSafetyInformation(value.safetyInformation);
  if (producer) gpsr.producer = producer;
  if (responsiblePerson) gpsr.responsiblePerson = responsiblePerson;
  if (importer) gpsr.importer = importer;
  if (safetyInformation) gpsr.safetyInformation = safetyInformation;
  return Object.keys(gpsr).length > 0 ? gpsr : null;
}
