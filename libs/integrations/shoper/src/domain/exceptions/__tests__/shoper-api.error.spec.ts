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
