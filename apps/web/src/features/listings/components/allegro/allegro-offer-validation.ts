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
 * Every label and message reads the `listings.allegroOfferValidation` copy when
 * it is read (blocker labels are getters), never at module load, so the words
 * follow the active language.
 *
 * @module features/listings/components/allegro
 */
import {
  getBcp47Locale,
  getLocale,
  getMessages,
  interpolate,
  type Messages,
  type ResolvedCopy,
} from '../../../../shared/i18n';
import type {
  OfferRowBundleInput,
  OfferRowValidationInput,
  OfferValidationContribution,
} from '../../../../shared/plugins';
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
export const ALLEGRO_BUNDLE_COMPONENT_MISSING_BLOCKER = 'allegro:bundle-component-missing';
export const ALLEGRO_BUNDLE_COMPONENT_GPSR_MISSING_BLOCKER =
  'allegro:bundle-component-gpsr-missing';
export const ALLEGRO_BUNDLE_CATEGORY_MISMATCH_BLOCKER = 'allegro:bundle-category-mismatch';
/**
 * The refusal codes the adapter's product-set planning raises per component
 * (`planProductSet`, #3520), as the bundle preview reports them. Mirrored here
 * because the browser cannot import the adapter.
 */
export const ALLEGRO_PRODUCT_SET_UNPUBLISHABLE_CODE = 'PRODUCT_SET_COMPONENT_UNPUBLISHABLE';
export const ALLEGRO_PRODUCT_SET_GPSR_MISSING_CODE = 'PRODUCT_SET_COMPONENT_GPSR_MISSING';
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
  const items = getMessages('listings').allegroOfferValidation.missingSellerDetails.items;
  if (!locationComplete) missing.push(items.shipFromLocation);
  if (!isFilled(defaults?.['responsibleProducerId'])) missing.push(items.responsibleProducer);
  if (!isSafetyInformationComplete(defaults?.['safetyInformation'])) {
    missing.push(items.safetyInformation);
  }

  return missing;
}

/** "a, b and c" - a plain list in the active language, no trailing punctuation. */
function joinPlainly(parts: readonly string[]): string {
  return new Intl.ListFormat(getBcp47Locale(getLocale()), { type: 'conjunction' }).format(parts);
}

/** The blocker chip labels, read when a chip renders. */
function blockerLabels(): ResolvedCopy<Messages['listings']>['allegroOfferValidation']['blockers'] {
  return getMessages('listings').allegroOfferValidation.blockers;
}

/**
 * A bundle publishes as one product-set offer, so the checks about a single
 * product (its own barcode, its own catalogue card, offer-level product
 * parameters, sibling grouping) do not apply to it and are skipped rather than
 * reported falsely. What can stop it is each component, and the category: Allegro
 * requires the offer's category to equal that of the FIRST component's card.
 */
function validateBundleRow(
  input: OfferRowValidationInput,
  bundle: OfferRowBundleInput,
): string[] {
  const blockers: string[] = [];
  if (isAllegroTitleTooLong(input.title)) {
    blockers.push(ALLEGRO_TITLE_TOO_LONG_BLOCKER);
  } else if (isAllegroTitleTooShort(input.title)) {
    blockers.push(ALLEGRO_TITLE_TOO_SHORT_BLOCKER);
  }
  if (input.imageCount === 0) blockers.push(ALLEGRO_NO_PHOTO_BLOCKER);

  const hasProblem = (code: string): boolean =>
    bundle.components.some((component) =>
      component.problems.some((problem) => problem.code === code),
    );
  if (hasProblem(ALLEGRO_PRODUCT_SET_UNPUBLISHABLE_CODE)) {
    blockers.push(ALLEGRO_BUNDLE_COMPONENT_MISSING_BLOCKER);
  }
  if (hasProblem(ALLEGRO_PRODUCT_SET_GPSR_MISSING_CODE)) {
    blockers.push(ALLEGRO_BUNDLE_COMPONENT_GPSR_MISSING_BLOCKER);
  }
  if (
    bundle.suggestedCategoryId !== null &&
    bundle.chosenCategoryId !== null &&
    bundle.suggestedCategoryId !== bundle.chosenCategoryId
  ) {
    blockers.push(ALLEGRO_BUNDLE_CATEGORY_MISMATCH_BLOCKER);
  }
  return blockers;
}

export const allegroOfferValidation: OfferValidationContribution = {
  blockers: [
    {
      id: ALLEGRO_NEEDS_PRODUCT_PARAMETERS_BLOCKER,
      field: 'parameters',
      tone: 'warning',
      get label(): string {
        return blockerLabels().addProductParams;
      },
    },
    {
      id: ALLEGRO_TITLE_TOO_LONG_BLOCKER,
      field: 'title',
      tone: 'error',
      get label(): string {
        return blockerLabels().titleTooLong;
      },
    },
    {
      id: ALLEGRO_TITLE_TOO_SHORT_BLOCKER,
      field: 'title',
      tone: 'error',
      get label(): string {
        return blockerLabels().titleTooShort;
      },
    },
    {
      id: ALLEGRO_PARAM_VALUE_INVALID_BLOCKER,
      field: 'parameters',
      tone: 'error',
      get label(): string {
        return blockerLabels().paramValueRejected;
      },
    },
    {
      id: ALLEGRO_NO_PHOTO_BLOCKER,
      field: 'images',
      tone: 'error',
      get label(): string {
        return blockerLabels().noPhoto;
      },
    },
    {
      id: ALLEGRO_SIBLINGS_WITHOUT_CARD_BLOCKER,
      field: 'ean',
      tone: 'error',
      get label(): string {
        return blockerLabels().siblingsShareOneCard;
      },
    },
    {
      id: ALLEGRO_BUNDLE_COMPONENT_MISSING_BLOCKER,
      field: 'bundle',
      tone: 'error',
      get label(): string {
        return blockerLabels().bundleComponentMissing;
      },
    },
    {
      id: ALLEGRO_BUNDLE_COMPONENT_GPSR_MISSING_BLOCKER,
      field: 'bundle',
      tone: 'error',
      get label(): string {
        return blockerLabels().bundleComponentGpsrMissing;
      },
    },
    {
      id: ALLEGRO_BUNDLE_CATEGORY_MISMATCH_BLOCKER,
      field: 'bundle',
      tone: 'error',
      get label(): string {
        return blockerLabels().bundleCategoryMismatch;
      },
    },
    {
      id: ALLEGRO_EAN_UNVERIFIED_BLOCKER,
      field: 'ean',
      tone: 'warning',
      get label(): string {
        return blockerLabels().eanNotInCatalogue;
      },
      advisory: true,
    },
    {
      id: ALLEGRO_IN_STORE_BARCODE_BLOCKER,
      field: 'ean',
      tone: 'warning',
      get label(): string {
        return blockerLabels().inStoreBarcode;
      },
      advisory: true,
    },
  ],
  validateRow: (input) => {
    const blockers: string[] = [];
    if (input.bundle) {
      return validateBundleRow(input, input.bundle);
    }
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
        // A card WAS found, only set aside for the operator's mapping (#3994) -
        // "not in the catalogue" would be false.
        input.barcodeMatchedCatalogue !== true &&
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
    const copy = getMessages('listings').allegroOfferValidation.missingSellerDetails;
    return [
      {
        id: ALLEGRO_MISSING_SELLER_DEFAULTS_ISSUE,
        title: interpolate(copy.title, { items: joinPlainly(missing) }),
        detail: copy.detail,
      },
    ];
  },
  // Allegro's validator reads `needsProductParameters` and the parameter schema
  // itself (#2243), so the host must fetch the per-category schema for this
  // batch (#810 / #1096).
  needsCategoryParameterSchema: true,
};
