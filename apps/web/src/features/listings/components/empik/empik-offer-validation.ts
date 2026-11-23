/**
 * Empik offer validation
 *
 * Empik's row blockers (#4278), declared once for the bulk Review step and the
 * single-offer wizard:
 *
 * - `empik:no-ean`: an Empik offer points to a catalogue card found by EAN, so
 *   a row without one cannot be listed.
 * - `empik:no-card`: the card lookup ran and found no card for the EAN.
 *   Creating cards from OpenLinker is not available yet, so the product has
 *   to be added in the Empik panel first. Raised only when a lookup actually
 *   ran (`catalogueConsulted`), never on its absence.
 *
 * @module features/listings/components/empik
 */
import { getMessages } from '../../../../shared/i18n';
import type { OfferBlockerCopy, OfferValidationContribution } from '../../../../shared/plugins';

export const EMPIK_NO_EAN_BLOCKER = 'empik:no-ean';
export const EMPIK_NO_CARD_BLOCKER = 'empik:no-card';

export const empikOfferValidation: OfferValidationContribution = {
  blockers: [
    {
      id: EMPIK_NO_EAN_BLOCKER,
      tone: 'error',
      get label(): string {
        return getMessages('listings').empikOfferValidation.blockers.noEan;
      },
      field: 'ean',
      describe: (): OfferBlockerCopy => {
        const copy = getMessages('listings').bulkBlockers.empik.noEan;
        return { title: copy.title, detail: copy.detail };
      },
    },
    {
      id: EMPIK_NO_CARD_BLOCKER,
      tone: 'error',
      get label(): string {
        return getMessages('listings').empikOfferValidation.blockers.noCard;
      },
      field: 'ean',
      describe: (): OfferBlockerCopy => {
        const copy = getMessages('listings').bulkBlockers.empik.noCard;
        return { title: copy.title, detail: copy.detail };
      },
    },
  ],
  validateRow: (input) => {
    if (!input.barcode?.trim()) {
      return [EMPIK_NO_EAN_BLOCKER];
    }
    if (
      input.catalogueConsulted === true &&
      !input.willLinkProductCard &&
      input.barcodeMatchedCatalogue !== true
    ) {
      return [EMPIK_NO_CARD_BLOCKER];
    }
    return [];
  },
};
