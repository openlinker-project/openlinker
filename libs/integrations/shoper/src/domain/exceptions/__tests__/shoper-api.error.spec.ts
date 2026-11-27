import { ShoperApiError } from '../shoper-api.error';

describe('ShoperApiError.isResourceNotFound', () => {
  it('should be true for a 404 carrying Shoper’s own invalid_request envelope', () => {
    expect(new ShoperApiError(404, 'invalid_request', 'Resource not found').isResourceNotFound()).toBe(
      true,
    );
  });

  it('should not depend on the wording of the description', () => {
    expect(new ShoperApiError(404, 'invalid_request', 'Nie znaleziono zasobu').isResourceNotFound()).toBe(
      true,
    );
  });

  it.each([
    ['a bare 404 (HTML / empty body / proxy page)', new ShoperApiError(404)],
    ['a 404 with an unrelated error code', new ShoperApiError(404, 'server_error')],
    ['a 400 invalid_request (Shoper’s answer to a wrong path)', new ShoperApiError(400, 'invalid_request', "Missing MODULE 'x'")],
    ['a 401', new ShoperApiError(401, 'unauthorized_client')],
    ['a 403', new ShoperApiError(403, 'insufficient_scope')],
    ['a 500', new ShoperApiError(500, 'server_error')],
  ])('should be false for %s', (_label, error) => {
    expect(error.isResourceNotFound()).toBe(false);
  });
});

describe('ShoperApiError.isValueNotFound', () => {
  it.each([
    ['the exact live answer', 'Nie znaleziono wartości'],
    ['different casing and spacing', '  nie  ZNALEZIONO wartości '],
    ['the phrase without diacritics', 'Nie znaleziono wartosci'],
    ['the phrase inside a longer description', 'Pole shipping_id: Nie znaleziono wartości.'],
    ['a decomposed (NFD) diacritic', 'Nie znaleziono wartości'],
  ])('should be true for a 400 carrying %s', (_label, description) => {
    expect(new ShoperApiError(400, 'invalid_request', description).isValueNotFound()).toBe(true);
  });

  it.each([
    ['a 400 with another description', new ShoperApiError(400, 'invalid_request', 'status_id invalid')],
    ['a 400 with no description', new ShoperApiError(400, 'invalid_request')],
    ['the phrase on a 404', new ShoperApiError(404, 'invalid_request', 'Nie znaleziono wartości')],
    ['the phrase on a 500', new ShoperApiError(500, 'server_error', 'Nie znaleziono wartości')],
  ])('should be false for %s', (_label, error) => {
    expect(error.isValueNotFound()).toBe(false);
  });

  it('should keep the full description while bounding the message', () => {
    const long = `Nie znaleziono wartości ${'x'.repeat(300)}`;
    const error = new ShoperApiError(400, 'invalid_request', long);

    expect(error.errorDescription).toBe(long);
    expect(error.message.length).toBeLessThan(long.length);
  });
});
