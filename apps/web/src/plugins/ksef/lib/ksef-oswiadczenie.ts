/**
 * KSeF oświadczenie o pominięciu numeru — content assembly (#1695)
 *
 * Pure helpers that turn a recorded numbering-gap note + the series identity +
 * the KSeF connection's seller profile into the data (and plain-text form) of a
 * printable "oświadczenie o pominięciu numeru faktury" — the written statement
 * PL practice keeps in the tax file for a skipped invoice number. Kept in the
 * plugin (not the neutral feature) because the Polish wording is a national
 * specific that must not leak into `libs/core` or `features/invoicing`.
 *
 * The seller reader mirrors `readKsefSeller` in `ksef-connection-config.ts`
 * (same `config.seller` shape + legacy flat `config.sellerNip` fallback), shaped
 * here for display rather than form hydration.
 *
 * The Polish wording itself lives under `oswiadczenie` in the plugin's
 * locale files and is Polish in every language.
 *
 * @module plugins/ksef/lib
 */
import { interpolate } from '../../../shared/i18n';
import { getKsefMessages } from '../messages';

/** Seller profile the oświadczenie header is printed from. */
export interface KsefSellerProfile {
  nip: string;
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  countryIso2: string;
}

/** Everything needed to render one oświadczenie document. */
export interface KsefOswiadczenieContent {
  seller: KsefSellerProfile;
  /** Human-facing series name (e.g. "Faktury sprzedaży"). */
  seriesName: string;
  /** The series pattern, printed as the series' machine identity. */
  seriesPattern: string;
  /** The skipped number as it would have rendered (P_2-style), or the bare sequence. */
  skippedNumber: string;
  /** The operator's recorded reason for the gap. */
  reason: string;
  /** Issue timestamp; defaults to now. */
  issuedAt?: Date;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Read the seller profile out of a KSeF connection's `config.seller` (#1223),
 * falling back to the legacy flat `config.sellerNip` for connections saved
 * before the nested shape existed.
 */
export function readKsefSellerProfile(config: Record<string, unknown>): KsefSellerProfile {
  const seller =
    typeof config.seller === 'object' && config.seller !== null
      ? (config.seller as Record<string, unknown>)
      : {};
  const address =
    typeof seller.address === 'object' && seller.address !== null
      ? (seller.address as Record<string, unknown>)
      : {};
  const nip =
    typeof seller.nip === 'string'
      ? seller.nip
      : typeof config.sellerNip === 'string'
        ? config.sellerNip
        : '';
  return {
    nip,
    name: readString(seller, 'name'),
    addressLine1: readString(address, 'line1'),
    addressLine2: readString(address, 'line2'),
    city: readString(address, 'city'),
    postalCode: readString(address, 'postalCode'),
    countryIso2: readString(address, 'countryIso2'),
  };
}

/** Whether the profile carries at least a name or a NIP - enough to print a header. */
export function hasPrintableSeller(seller: KsefSellerProfile): boolean {
  return seller.name.trim().length > 0 || seller.nip.trim().length > 0;
}

/**
 * The seller address as display lines: street line(s) then a "postal city"
 * line. Empty leaves are dropped so a partial profile still prints cleanly.
 */
export function formatSellerAddressLines(seller: KsefSellerProfile): string[] {
  const lines: string[] = [];
  if (seller.addressLine1.trim().length > 0) lines.push(seller.addressLine1.trim());
  if (seller.addressLine2.trim().length > 0) lines.push(seller.addressLine2.trim());
  const cityLine = [seller.postalCode.trim(), seller.city.trim()].filter(Boolean).join(' ').trim();
  if (cityLine.length > 0) lines.push(cityLine);
  return lines;
}

/** A NIP formatted digits-only for display (already normalised on save). */
export function formatSellerNip(seller: KsefSellerProfile): string {
  return seller.nip.trim();
}

/**
 * Long-form Polish date, e.g. "16 lipca 2026 r.". Always Polish: the
 * oświadczenie is a Polish legal document in every interface language.
 */
export function formatPolishDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return interpolate(getKsefMessages().oswiadczenie.date, { date: formatted });
}

/** The "place, date" line - city (when known) + long-form date. */
export function formatPlaceAndDate(seller: KsefSellerProfile, date: Date): string {
  const copy = getKsefMessages().oswiadczenie;
  const place = seller.city.trim();
  const dated = interpolate(copy.dated, { date: formatPolishDate(date) });
  return place.length > 0 ? interpolate(copy.placeAndDate, { place, dated }) : dated;
}

/**
 * The oświadczenie body sentence - states the skipped number was omitted and
 * will not be assigned to any invoice, naming the seller and the series.
 */
export function formatOswiadczenieBody(content: KsefOswiadczenieContent): string {
  const copy = getKsefMessages().oswiadczenie;
  const sellerName = content.seller.name.trim();
  const params = { number: content.skippedNumber, series: content.seriesName };
  return sellerName.length > 0
    ? interpolate(copy.bodyWithSeller, { ...params, seller: sellerName })
    : interpolate(copy.body, params);
}

/** The dotted line a signature goes on in the plain-text form. */
const SIGNATURE_LINE = '.................................................';

/**
 * Plain-text rendering of the whole document, for the "Copy text" action. Mirrors
 * the on-screen sheet order: header, place+date, title, body, reason, continuity,
 * series identity, signature line.
 */
export function buildOswiadczenieText(content: KsefOswiadczenieContent): string {
  const copy = getKsefMessages().oswiadczenie;
  const issuedAt = content.issuedAt ?? new Date();
  const lines: string[] = [];

  const sellerName = content.seller.name.trim();
  if (sellerName.length > 0) lines.push(sellerName);
  for (const line of formatSellerAddressLines(content.seller)) lines.push(line);
  const nip = formatSellerNip(content.seller);
  if (nip.length > 0) lines.push(interpolate(copy.nip, { nip }));

  lines.push('');
  lines.push(formatPlaceAndDate(content.seller, issuedAt));
  lines.push('');
  lines.push(copy.title);
  lines.push('');
  lines.push(formatOswiadczenieBody(content));
  lines.push('');
  lines.push(interpolate(copy.reasonLine, { reason: content.reason }));
  lines.push('');
  lines.push(copy.continuity);
  lines.push('');
  lines.push(
    interpolate(copy.seriesLine, { name: content.seriesName, pattern: content.seriesPattern }),
  );
  lines.push(interpolate(copy.skippedLine, { number: content.skippedNumber }));
  lines.push('');
  lines.push('');
  lines.push(SIGNATURE_LINE);
  lines.push(copy.signature);

  return lines.join('\n');
}
