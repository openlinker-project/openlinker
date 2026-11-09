/**
 * Erli offer validation
 *
 * Declares Erli's per-row blocker (missing image) and the pure row validator,
 * in ONE place (#1096). Consumed by the bulk Review step via the plugin's
 * `platform.offerValidation` slot, so the rule lives with the other Erli
 * offer-field logic. Erli's `POST /products/{id}` requires ≥1 image, so a row
 * whose master product carries none is blocked.
 *
 * @module features/listings/components/erli
 */
import { getMessages } from '../../../../shared/i18n';
import type { OfferValidationContribution } from '../../../../shared/plugins';

export const ERLI_MISSING_IMAGE_BLOCKER = 'erli:missing-image';

export const erliOfferValidation: OfferValidationContribution = {
  blockers: [
    {
      id: ERLI_MISSING_IMAGE_BLOCKER,
      tone: 'error',
      // A getter, so the label is read in the language active when the chip renders.
      get label(): string {
        return getMessages('listings').erliOfferValidation.blockers.noImage;
      },
    },
  ],
  validateRow: (input) => (input.imageCount === 0 ? [ERLI_MISSING_IMAGE_BLOCKER] : []),
};
