/**
 * Empik offer validation
 *
 * Empik's row checks (#4278), declared once for the bulk Review step and the
 * single-offer wizard. A row without an EAN is already blocked by the host's
 * own "no barcode" check, and a row without a card and without a category by
 * the host's category check, so Empik adds only what a NEW product card needs.
 *
 * A card is created when the card lookup ran for this row's barcode and found
 * nothing (`catalogueConsulted`, never on its absence: an EAN typed in the row
 * editor was not looked up). Then:
 *
 * - `empik:new-card` (advisory): OpenLinker sends a new product card to Empik
 *   and lists the offer once Empik accepts it, which can take a while.
 * - `empik:card-no-image`: a card needs a main image.
 * - `empik:card-no-description`: a card needs a description; nothing fills it
 *   when the master product has none and AI does not write one.
 * - `empik:card-missing-parameters`: the category's required card attributes
 *   are not all filled. The host decides this from the category schema and the
 *   values the operator or an attribute rule supplied; the attributes
 *   OpenLinker fills itself (title, description, images, VAT, ...) are not in
 *   that schema, so they are never asked for.
 *
 * The backend checks the same card before it is sent and refuses it naming
 * the attribute, so these chips only bring that answer forward.
 *
 * @module features/listings/components/empik
 */
import { getMessages } from '../../../../shared/i18n';
import type {
  OfferBlockerCopy,
  OfferRowValidationInput,
  OfferValidationContribution,
} from '../../../../shared/plugins';

export const EMPIK_NEW_CARD_NOTICE = 'empik:new-card';
export const EMPIK_CARD_NO_IMAGE_BLOCKER = 'empik:card-no-image';
export const EMPIK_CARD_MISSING_PARAMETERS_BLOCKER = 'empik:card-missing-parameters';
export const EMPIK_CARD_NO_DESCRIPTION_BLOCKER = 'empik:card-no-description';

function copyOf(
  key: 'newCard' | 'cardNoImage' | 'cardNoDescription' | 'cardMissingParameters',
): OfferBlockerCopy {
  const copy = getMessages('listings').bulkBlockers.empik[key];
  return { title: copy.title, detail: copy.detail };
}

/** The lookup ran for this barcode and Empik has no card for it. */
function willCreateCard(input: OfferRowValidationInput): boolean {
  return (
    input.catalogueConsulted === true &&
    !input.willLinkProductCard &&
    input.barcodeMatchedCatalogue !== true
  );
}

export const empikOfferValidation: OfferValidationContribution = {
  blockers: [
    {
      id: EMPIK_NEW_CARD_NOTICE,
      tone: 'info',
      advisory: true,
      get label(): string {
        return getMessages('listings').empikOfferValidation.blockers.newCard;
      },
      describe: (): OfferBlockerCopy => copyOf('newCard'),
    },
    {
      id: EMPIK_CARD_NO_IMAGE_BLOCKER,
      tone: 'error',
      field: 'images',
      get label(): string {
        return getMessages('listings').empikOfferValidation.blockers.cardNoImage;
      },
      describe: (): OfferBlockerCopy => copyOf('cardNoImage'),
    },
    {
      id: EMPIK_CARD_NO_DESCRIPTION_BLOCKER,
      tone: 'error',
      get label(): string {
        return getMessages('listings').empikOfferValidation.blockers.cardNoDescription;
      },
      describe: (): OfferBlockerCopy => copyOf('cardNoDescription'),
    },
    {
      id: EMPIK_CARD_MISSING_PARAMETERS_BLOCKER,
      tone: 'error',
      field: 'parameters',
      get label(): string {
        return getMessages('listings').empikOfferValidation.blockers.cardMissingParameters;
      },
      describe: (): OfferBlockerCopy => copyOf('cardMissingParameters'),
    },
  ],
  validateRow: (input) => {
    if (!input.barcode?.trim() || !willCreateCard(input)) {
      return [];
    }
    const ids = [EMPIK_NEW_CARD_NOTICE];
    if (input.imageCount === 0) {
      ids.push(EMPIK_CARD_NO_IMAGE_BLOCKER);
    }
    // Only a computed `false` blocks: an absent answer is not "no description".
    if (input.hasDescription === false) {
      ids.push(EMPIK_CARD_NO_DESCRIPTION_BLOCKER);
    }
    if (input.needsProductParameters) {
      ids.push(EMPIK_CARD_MISSING_PARAMETERS_BLOCKER);
    }
    return ids;
  },
  // `needsProductParameters` is only computed when the host loads the
  // category's parameter schema.
  needsCategoryParameterSchema: true,
};
