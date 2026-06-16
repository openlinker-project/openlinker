/**
 * Product Publish Rejected Exception — unit spec
 *
 * Locks the neutral message format (singular vs plural error count) and the
 * structured fields core services persist (adapterKey, statusCode, errors), and
 * asserts the message never embeds a request/response body (no secret leak).
 *
 * @module libs/core/src/listings/domain/exceptions/__tests__
 */

import type { CreateOfferValidationError } from '../../types/offer-create.types';
import { ProductPublishRejectedException } from '../product-publish-rejected.exception';

function makeError(code: string): CreateOfferValidationError {
  return { code, message: `boom: ${code}` };
}

describe('ProductPublishRejectedException', () => {
  it('exposes the structured fields and a stable name', () => {
    const errors = [makeError('PARAMETER_REQUIRED')];
    const ex = new ProductPublishRejectedException('woocommerce.restapi.v1', 422, errors);

    expect(ex).toBeInstanceOf(Error);
    expect(ex.name).toBe('ProductPublishRejectedException');
    expect(ex.adapterKey).toBe('woocommerce.restapi.v1');
    expect(ex.statusCode).toBe(422);
    expect(ex.errors).toBe(errors);
  });

  it('uses the singular "error" form for exactly one error', () => {
    const ex = new ProductPublishRejectedException('woocommerce.restapi.v1', 400, [
      makeError('A'),
    ]);
    expect(ex.message).toBe(
      'Shop woocommerce.restapi.v1 rejected product publish (status=400, 1 error)',
    );
  });

  it('uses the plural "errors" form for zero or multiple errors', () => {
    const none = new ProductPublishRejectedException('woocommerce.restapi.v1', 400, []);
    expect(none.message).toBe(
      'Shop woocommerce.restapi.v1 rejected product publish (status=400, 0 errors)',
    );

    const many = new ProductPublishRejectedException('woocommerce.restapi.v1', 422, [
      makeError('A'),
      makeError('B'),
    ]);
    expect(many.message).toBe(
      'Shop woocommerce.restapi.v1 rejected product publish (status=422, 2 errors)',
    );
  });

  it('does not embed validation-error detail in the message (no leak)', () => {
    const ex = new ProductPublishRejectedException('woocommerce.restapi.v1', 422, [
      makeError('SECRET_ish_detail'),
    ]);
    expect(ex.message).not.toContain('SECRET_ish_detail');
    expect(ex.message).not.toContain('boom');
  });
});
