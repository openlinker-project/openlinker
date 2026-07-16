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
 * @module plugins/ksef/lib
 */

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

/** Whether the profile carries at least a name or a NIP — enough to print a header. */
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

/** Long-form Polish date, e.g. "16 lipca 2026 r." */
export function formatPolishDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  return `${formatted} r.`;
}

/** The "place, date" line — city (when known) + long-form date. */
export function formatPlaceAndDate(seller: KsefSellerProfile, date: Date): string {
  const place = seller.city.trim();
  const dated = `dnia ${formatPolishDate(date)}`;
  return place.length > 0 ? `${place}, ${dated}` : dated;
}

export const OSWIADCZENIE_TITLE = 'Oświadczenie o pominięciu numeru faktury';

/**
 * The oświadczenie body sentence — states the skipped number was omitted and
 * will not be assigned to any invoice, naming the seller and the series.
 */
export function formatOswiadczenieBody(content: KsefOswiadczenieContent): string {
  const sellerName = content.seller.name.trim();
  const actingAs =
    sellerName.length > 0
      ? `Działając w imieniu ${sellerName}, oświadczam`
      : 'Oświadczam';
  return (
    `${actingAs}, że numer ${content.skippedNumber} w serii numeracji ` +
    `„${content.seriesName}" został pominięty i nie został oraz nie zostanie ` +
    `przypisany do żadnej faktury.`
  );
}

/**
 * The continuity-preserved sentence — reassures that skipping the number does
 * not break the chronological continuity of the series' numbering.
 */
export const OSWIADCZENIE_CONTINUITY =
  'Pominięcie powyższego numeru nie narusza ciągłości numeracji faktur — ' +
  'kolejne numery w tej serii są nadawane w sposób ciągły i chronologiczny.';

/**
 * Plain-text rendering of the whole document, for the "Copy text" action. Mirrors
 * the on-screen sheet order: header, place+date, title, body, reason, continuity,
 * series identity, signature line.
 */
export function buildOswiadczenieText(content: KsefOswiadczenieContent): string {
  const issuedAt = content.issuedAt ?? new Date();
  const lines: string[] = [];

  const sellerName = content.seller.name.trim();
  if (sellerName.length > 0) lines.push(sellerName);
  for (const line of formatSellerAddressLines(content.seller)) lines.push(line);
  const nip = formatSellerNip(content.seller);
  if (nip.length > 0) lines.push(`NIP: ${nip}`);

  lines.push('');
  lines.push(formatPlaceAndDate(content.seller, issuedAt));
  lines.push('');
  lines.push(OSWIADCZENIE_TITLE);
  lines.push('');
  lines.push(formatOswiadczenieBody(content));
  lines.push('');
  lines.push(`Przyczyna pominięcia: ${content.reason}`);
  lines.push('');
  lines.push(OSWIADCZENIE_CONTINUITY);
  lines.push('');
  lines.push(`Seria: ${content.seriesName} (${content.seriesPattern})`);
  lines.push(`Pominięty numer: ${content.skippedNumber}`);
  lines.push('');
  lines.push('');
  lines.push('.................................................');
  lines.push('(podpis osoby upoważnionej)');

  return lines.join('\n');
}
