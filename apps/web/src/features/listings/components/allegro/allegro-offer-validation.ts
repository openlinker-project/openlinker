/**
 * Allegro offer validation
 *
 * Declares Allegro's platform-specific per-row blockers and the pure row
 * validator, migrated out of the host `BulkRowBlocker` enum onto the plugin
 * contract (#1096). Every rule here answers a rejection Allegro would otherwise
 * return AFTER the operator submitted, one record at a time.
 *
 * - `needs-product-parameters` (#810) — a row that creates a product inline (no
 *   catalogue card to inherit from) under a category with required product-
 *   section params it hasn't supplied would 422 at submit; card-linked rows are
 *   exempt (they inherit the params).
 * - `title-too-long` (#1962) — the pre-submit half of the adapter's 75-char
 *   title check (#1934/F11).
 * - `title-too-short` (#2243) — the other end of the same rule: Allegro also
 *   needs 12 characters and 3 words, which a short master product name fails.
 * - `param-value-invalid` (#2243) — a value that breaks a bound the CATEGORY
 *   ITSELF declared (length, range, precision, dictionary, value count). Only
 *   operator-authored values are visible here; values injected by attribute
 *   mapping rules are checked in core, because the browser cannot see them.
 * - `no-photo` (#2243) — Allegro publishes nothing without an image. Measured on
 *   the effective set (variant, else product), and skipped for a card-linked row
 *   which inherits the card's photos.
 * - `siblings-without-card` (#2243) — a multi-variant product where only SOME
 *   siblings resolve to a catalogue card. Allegro mints one card from the first
 *   variant it accepts and rejects the rest with
 *   `ProductConstraintViolationException.DataIntegrity`, so this is a
 *   product-level fact no single row can see.
 * - `ean-unverified` / `in-store-barcode` (#2243) — ADVISORY. A catalogue miss
 *   is not proof the barcode is unregistered, so blocking would assert something
 *   we do not know; a restricted-circulation prefix is a stronger signal but
 *   still ours, not the platform's. Both warn and neither gates the batch.
 *
 * The neutral price/stock/category blockers stay host-owned — only the
 * Allegro-specific ones live here.
 *
 * @module features/listings/components/allegro
 */
import type { OfferValidationContribution } from '../../../../shared/plugins';
import { isRestrictedCirculationGtin } from '../../lib/gtin-classification';
import { checkRowParameterRestrictions } from '../../lib/parameter-restrictions';
import { isAllegroTitleTooLong, isAllegroTitleTooShort } from './allegro-title';

export const ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER = 'allegro:needs-product-parameters';
export const ALLEGRO_TITLE_TOO_LONG_BLOCKER = 'allegro:title-too-long';
export const ALLEGRO_TITLE_TOO_SHORT_BLOCKER = 'allegro:title-too-short';
export const ALLEGRO_PARAM_VALUE_INVALID_BLOCKER = 'allegro:param-value-invalid';
export const ALLEGRO_NO_PHOTO_BLOCKER = 'allegro:no-photo';
export const ALLEGRO_SIBLINGS_WITHOUT_CARD_BLOCKER = 'allegro:siblings-without-card';
export const ALLEGRO_EAN_UNVERIFIED_BLOCKER = 'allegro:ean-unverified';
export const ALLEGRO_IN_STORE_BARCODE_BLOCKER = 'allegro:in-store-barcode';
export const ALLEGRO_MISSING_SELLER_DEFAULTS_ISSUE = 'allegro:missing-seller-details';

/**
 * Every `sellerDefaults` path Allegro's own create-time gate can report as
 * missing - a declared mirror of `collectMissingSellerDefaultsFields` in
 * `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts`,
 * which is the FIRST statement of `createOffer` and unconditional (card-linked
 * offers are not exempt), so a connection missing any of these cannot create
 * anything.
 *
 * The list exists so the two halves can be compared by machine:
 * `scripts/check-allegro-seller-defaults-mirror.mjs` (under
 * `pnpm check:invariants`) fails the build when the adapter's gate grows,
 * renames or drops a path this file does not know about. Without it the mirror
 * goes quietly stale and the banner starts UNDER-reporting - the same
 * silent-green failure the pre-submit check exists to close, one layer up.
 *
 * `description` and `attachments` are the two arms of `safetyInformation.type`;
 * the adapter reports at most one, this file requires whichever the declared
 * type selects.
 */
export const ALLEGRO_SELLER_DEFAULT_PATHS = [
  'sellerDefaults.location',
  'sellerDefaults.location.countryCode',
  'sellerDefaults.location.province',
  'sellerDefaults.location.city',
  'sellerDefaults.location.postCode',
  'sellerDefaults.responsibleProducerId',
  'sellerDefaults.safetyInformation',
  'sellerDefaults.safetyInformation.type',
  'sellerDefaults.safetyInformation.description',
  'sellerDefaults.safetyInformation.attachments',
] as const;

const SELLER_LOCATION_FIELDS = ['countryCode', 'province', 'city', 'postCode'] as const;

/**
 * Present-and-non-blank, matching the adapter's own `!loc?.countryCode` /
 * `!safety?.type` truthiness checks.
 *
 * ONE divergence, deliberate and in the safe direction: a whitespace-only string
 * is reported missing here and passes the adapter's gate. Blank-after-trim is
 * not a value in any reading, and Allegro rejects it, so the batch is wasted
 * either way - naming it before submit is the whole point. Everything else
 * matches the adapter exactly, because this check now BLOCKS the submit (see
 * `OfferBatchIssue`) and a mirror stricter than the gate would lock an operator
 * out of a batch the destination would have accepted.
 */
const isFilled = (value: unknown): boolean =>
  typeof value === 'string' ? value.trim() !== '' : Boolean(value);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * Whether `safetyInformation` is complete on the adapter's terms: a `type` is
 * required, and the arm that type selects must carry a value. An unrecognised
 * type is accepted here because the adapter accepts it too - it only asserts
 * `type` is present - and inventing a stricter rule would block a submit the
 * destination allows.
 */
function isSafetyInformationComplete(raw: unknown): boolean {
  const safety = asRecord(raw);
  if (!safety || !isFilled(safety['type'])) return false;
  if (safety['type'] === 'TEXT') {
    const description = safety['description'];
    return typeof description === 'string' && description.length > 0;
  }
  if (safety['type'] === 'ATTACHMENTS') {
    const attachments = safety['attachments'];
    return Array.isArray(attachments) && attachments.length > 0;
  }
  return true;
}

/**
 * Which seller-detail groups the connection is missing, in the operator's
 * words. Empty ⇒ nothing to report.
 *
 * Grouped rather than path-by-path on purpose: `sellerDefaults.location.postCode`
 * is not a sentence an operator can act on, and all four location fields are
 * edited in one place. The path list above is what the guard compares; this is
 * what the banner says.
 */
export function missingAllegroSellerDetails(config: Record<string, unknown>): string[] {
  const defaults = asRecord(config['sellerDefaults']);
  const missing: string[] = [];

  const location = asRecord(defaults?.['location']);
  const locationComplete =
    location !== undefined && SELLER_LOCATION_FIELDS.every((field) => isFilled(location[field]));
  if (!locationComplete) missing.push('a ship-from location');
  if (!isFilled(defaults?.['responsibleProducerId'])) missing.push('a responsible producer');
  if (!isSafetyInformationComplete(defaults?.['safetyInformation'])) {
    missing.push('safety information');
  }

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
      field: 'parameters',
      tone: 'warning',
      label: 'add product params',
    },
    {
      id: ALLEGRO_TITLE_TOO_LONG_BLOCKER,
      field: 'title',
      tone: 'error',
      label: 'title too long',
    },
    {
      id: ALLEGRO_TITLE_TOO_SHORT_BLOCKER,
      field: 'title',
      tone: 'error',
      label: 'title too short',
    },
    {
      id: ALLEGRO_PARAM_VALUE_INVALID_BLOCKER,
      field: 'parameters',
      tone: 'error',
      label: 'parameter value rejected',
    },
    {
      id: ALLEGRO_NO_PHOTO_BLOCKER,
      field: 'images',
      tone: 'error',
      label: 'no photo',
    },
    {
      id: ALLEGRO_SIBLINGS_WITHOUT_CARD_BLOCKER,
      field: 'ean',
      tone: 'error',
      label: 'siblings share one card',
    },
    {
      id: ALLEGRO_EAN_UNVERIFIED_BLOCKER,
      field: 'ean',
      tone: 'warning',
      label: 'EAN not in catalogue',
      advisory: true,
    },
    {
      id: ALLEGRO_IN_STORE_BARCODE_BLOCKER,
      field: 'ean',
      tone: 'warning',
      label: 'in-store barcode',
      advisory: true,
    },
  ],
  validateRow: (input) => {
    const blockers: string[] = [];
    if (input.needsProductParameters && !input.willLinkProductCard) {
      blockers.push(ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER);
    }
    if (isAllegroTitleTooLong(input.title)) {
      blockers.push(ALLEGRO_TITLE_TOO_LONG_BLOCKER);
    } else if (isAllegroTitleTooShort(input.title)) {
      // Exclusive with the ceiling - one title cannot be both, and two chips
      // for one field would read as two problems.
      blockers.push(ALLEGRO_TITLE_TOO_SHORT_BLOCKER);
    }

    // A card-linked offer inherits the card's photos, so an empty local set is
    // not a missing photo there.
    if (input.imageCount === 0 && !input.willLinkProductCard) {
      blockers.push(ALLEGRO_NO_PHOTO_BLOCKER);
    }

    // Product-section values come from the card when one is linked, so a bound
    // violation on a card-linked row is about a value we would not send.
    if (!input.willLinkProductCard && input.categoryParameters && input.suppliedParameters) {
      const issues = checkRowParameterRestrictions(
        input.categoryParameters,
        input.suppliedParameters,
      );
      if (issues.length > 0) blockers.push(ALLEGRO_PARAM_VALUE_INVALID_BLOCKER);
    }

    // Grouping only works when every sibling owns its own card. Raised on every
    // affected row (the host renders it once per product) and only when SOME
    // siblings have one - if none do, each variant lists standalone, which is a
    // different, legitimate shape.
    const siblings = input.includedSiblingCount ?? 1;
    const cardless = input.siblingsWithoutCatalogueCard ?? 0;
    if (siblings > 1 && cardless > 0 && cardless < siblings) {
      blockers.push(ALLEGRO_SIBLINGS_WITHOUT_CARD_BLOCKER);
    }

    const barcode = (input.barcode ?? '').trim();
    if (barcode !== '') {
      if (isRestrictedCirculationGtin(barcode)) {
        blockers.push(ALLEGRO_IN_STORE_BARCODE_BLOCKER);
      } else if (
        input.catalogueConsulted === true &&
        !input.willLinkProductCard &&
        !blockers.includes(ALLEGRO_SIBLINGS_WITHOUT_CARD_BLOCKER)
      ) {
        // Only meaningful when a lookup actually ran, and silent when the
        // product-level card problem already says it louder.
        blockers.push(ALLEGRO_EAN_UNVERIFIED_BLOCKER);
      }
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
          'Allegro requires them on every offer, so every offer in this batch would be rejected. Add them in the connection settings, then come back - the submit stays locked until they are set.',
      },
    ];
  },
  // Allegro's validator reads `needsProductParameters` and the parameter schema
  // itself (#2243), so the host must fetch the per-category schema for this
  // batch (#810 / #1096).
  needsCategoryParameterSchema: true,
};
