import { isCredentialGrantError, readShopifyGrantError } from '../shopify-grant-error.policy';

describe('readShopifyGrantError', () => {
  it.each([
    ['{"error":"invalid_client","error_description":"x"}', 'invalid_client'],
    ['{"error":"shop_not_permitted"}', 'shop_not_permitted'],
    ['Oauth error app_not_installed', 'app_not_installed'],
    ['application_cannot_be_found', 'application_cannot_be_found'],
    ['<html>Bad gateway</html>', null],
    ['', null],
  ])('should read %p as %p', (body, code) => {
    expect(readShopifyGrantError(body)).toBe(code);
  });
});

describe('isCredentialGrantError', () => {
  it.each(['invalid_client', 'application_cannot_be_found', 'unauthorized_client', 'invalid_grant'])(
    'should treat %s as a credential problem',
    (code) => {
      expect(isCredentialGrantError(code)).toBe(true);
    },
  );

  it.each(['app_not_installed', 'shop_not_permitted', null])(
    'should not treat %p as a credential problem: the credentials are valid',
    (code) => {
      expect(isCredentialGrantError(code)).toBe(false);
    },
  );
});
