/**
 * Allegro offer validation
 *
 * Declares Allegro's platform-specific per-row blockers and the pure row
 * validator, migrated out of the host `BulkRowBlocker` enum onto the plugin
 * contract (#1096). Two rules today:
 *
 * - `needs-product-parameters` (#810) — a row that creates a product inline (no
 *   catalogue card to inherit from) under a category with required product-
 *   section params it hasn't supplied would 422 at submit; card-linked rows are
 *   exempt (they inherit the params).
 * - `title-too-long` (#1962) — the pre-submit half of the adapter's 75-char
 *   title check (#1934/F11). Without it an untouched row whose master product
 *   name is long reads **ready**, submits `202`, and only then terminates
 *   `business_failure` per record.
 *
 * The neutral price/stock/category blockers stay host-owned — only the
 * Allegro-specific ones live here.
 *
 * @module features/listings/components/allegro
 */
import type { OfferValidationContribution } from '../../../../shared/plugins';
import { isAllegroTitleTooLong } from './allegro-title';

export const ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER = 'allegro:needs-product-parameters';
export const ALLEGRO_TITLE_TOO_LONG_BLOCKER = 'allegro:title-too-long';
export const ALLEGRO_MISSING_SELLER_DEFAULTS_ISSUE = 'allegro:missing-seller-details';

/**
 * The three seller-detail groups `POST /sale/product-offers` requires on every
 * offer. The adapter's own gate (`collectMissingSellerDefaultsFields`) is the
 * first statement of `createOffer` and is unconditional - card-linked offers are
 * not exempt - so a connection missing any of them cannot create anything.
 * Mirrored here as the pre-submit warning; the adapter stays the authority.
 */
const SELLER_LOCATION_FIELDS = ['countryCode', 'province', 'city', 'postCode'] as const;

interface AllegroSellerDefaultsShape {
  location?: Record<string, unknown>;
  responsibleProducerId?: unknown;
  safetyInformation?: unknown;
}

const isFilled = (value: unknown): boolean =>
  typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;

/**
 * Which seller-detail groups the connection is missing, in the operator's
 * words. Empty ⇒ nothing to warn about.
 */
export function missingAllegroSellerDetails(config: Record<string, unknown>): string[] {
  const raw = config['sellerDefaults'];
  const defaults: AllegroSellerDefaultsShape =
    typeof raw === 'object' && raw !== null ? (raw as AllegroSellerDefaultsShape) : {};
  const missing: string[] = [];

  const location = defaults.location;
  const locationComplete =
    typeof location === 'object' &&
    location !== null &&
    SELLER_LOCATION_FIELDS.every((field) => isFilled(location[field]));
  if (!locationComplete) missing.push('a ship-from location');
  if (!isFilled(defaults.responsibleProducerId)) missing.push('a responsible producer');
  if (!isFilled(defaults.safetyInformation)) missing.push('safety information');

  return missing;
}

/** "a, b and c" - a plain list, no Oxford comma, no trailing punctuation. */
function joinPlainly(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export const allegroOfferValidation: OfferValidationContribution = {
  blockers: [
    {
      id: ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
      tone: 'warning',
      label: 'add product params',
    },
    {
      id: ALLEGRO_TITLE_TOO_LONG_BLOCKER,
      tone: 'error',
      label: 'title too long',
    },
  ],
  validateRow: (input) => {
    const blockers: string[] = [];
    if (input.needsProductParameters && !input.willLinkProductCard) {
      blockers.push(ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER);
    }
    if (isAllegroTitleTooLong(input.title)) {
      blockers.push(ALLEGRO_TITLE_TOO_LONG_BLOCKER);
    }
    return blockers;
  },
  validateBatch: (input) => {
    const missing = missingAllegroSellerDetails(input.connectionConfig);
    if (missing.length === 0) return [];
    return [
      {
        id: ALLEGRO_MISSING_SELLER_DEFAULTS_ISSUE,
        title: `This connection is missing ${joinPlainly(missing)}.`,
        detail:
          'Allegro requires them on every offer, so each one will be rejected. Add them in the connection settings, then come back.',
      },
    ];
  },
  // Allegro's validator reads `needsProductParameters`, so the host must fetch
  // the per-category required-param schema for this batch (#810 / #1096).
  needsCategoryParameterSchema: true,
};
