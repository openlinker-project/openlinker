/**
 * extractAllegroContentPublishErrors — unit tests
 *
 * Ports the legacy `extract-allegro-errors.test.ts` test cases verbatim
 * (#613). Behaviour unchanged — only the import path moved.
 *
 * @module plugins/allegro
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/api/api-error';
import { extractAllegroContentPublishErrors } from './extract-content-publish-errors';

describe('extractAllegroContentPublishErrors', () => {
  it('returns null for non-ApiError inputs', () => {
    expect(extractAllegroContentPublishErrors(null)).toBeNull();
    expect(extractAllegroContentPublishErrors(undefined)).toBeNull();
    expect(extractAllegroContentPublishErrors(new Error('plain'))).toBeNull();
    expect(extractAllegroContentPublishErrors('string error')).toBeNull();
  });

  it('returns null when ApiError.details is a string (e.g. text/plain bodies)', () => {
    expect(
      extractAllegroContentPublishErrors(new ApiError('boom', 422, 'plain text body')),
    ).toBeNull();
  });

  it('returns null when ApiError.details lacks the CHANNEL_PUBLISH_FAILED code', () => {
    expect(
      extractAllegroContentPublishErrors(
        new ApiError('boom', 422, { code: 'OTHER', errors: [] }),
      ),
    ).toBeNull();
  });

  it('returns null when errors is not an array', () => {
    expect(
      extractAllegroContentPublishErrors(
        new ApiError('boom', 422, { code: 'CHANNEL_PUBLISH_FAILED', errors: 'not-array' }),
      ),
    ).toBeNull();
  });

  it('returns null when an error entry is missing code or message', () => {
    expect(
      extractAllegroContentPublishErrors(
        new ApiError('boom', 422, {
          code: 'CHANNEL_PUBLISH_FAILED',
          errors: [{ code: 'OK', message: 'ok' }, { code: 'NO_MESSAGE' }],
        }),
      ),
    ).toBeNull();
  });

  it('returns the typed errors array when the body is a well-formed CHANNEL_PUBLISH_FAILED', () => {
    const result = extractAllegroContentPublishErrors(
      new ApiError('Channel publish rejected by Allegro', 422, {
        code: 'CHANNEL_PUBLISH_FAILED',
        errors: [
          {
            field: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
            code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
            message: 'Producent odpowiedzialny jest obowiązkowy dla każdego produktu w ofercie',
          },
          {
            code: 'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany',
            message: 'Warunki oferty (zwroty, reklamacje) są wymagane dla kont firma.',
          },
        ],
      }),
    );

    expect(result).toEqual([
      {
        field: 'offer.modules.productSafety.data.productsData[0].responsibleProducer',
        code: 'RESPONSIBLE_PRODUCER_NOT_SPECIFIED',
        message: 'Producent odpowiedzialny jest obowiązkowy dla każdego produktu w ofercie',
      },
      {
        code: 'ConstraintViolationException.AfterSalesServiceConditionsRequiredByCompany',
        message: 'Warunki oferty (zwroty, reklamacje) są wymagane dla kont firma.',
      },
    ]);
  });
});
