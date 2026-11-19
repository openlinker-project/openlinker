/**
 * Shopify Grant Error Policy
 *
 * Reads the error code out of a refused token request (client credentials,
 * OAuth code exchange or refresh). Shopify answers these with a JSON body
 * (`{"error": "invalid_client", ...}`) on some paths and plain text
 * (`Oauth error app_not_installed`) on others (spike #3928, L-C1 / G03), so
 * both are read. The code drives the tester's message and the classifiers;
 * nothing else in the body is kept, so no reader depends on its wording.
 *
 * @module libs/integrations/shopify/src/domain/policies
 */

/** Codes the plugin tells apart; any other code is carried through verbatim. */
export const ShopifyKnownGrantErrorValues = [
  'app_not_installed',
  'shop_not_permitted',
  'application_cannot_be_found',
  'invalid_client',
  'invalid_grant',
  'invalid_request',
  'unauthorized_client',
] as const;
export type ShopifyKnownGrantError = (typeof ShopifyKnownGrantErrorValues)[number];

const CODE_IN_TEXT = new RegExp(`\\b(${ShopifyKnownGrantErrorValues.join('|')})\\b`);

export function readShopifyGrantError(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object') {
      const code = (parsed as Record<string, unknown>).error;
      if (typeof code === 'string' && code.length > 0) {
        return code;
      }
    }
  } catch {
    // not JSON: fall through to the text form
  }
  const match = CODE_IN_TEXT.exec(body);
  return match === null ? null : match[1];
}

/** The credentials themselves are wrong or revoked: only the operator can fix them. */
export function isCredentialGrantError(code: string | null): boolean {
  return (
    code === 'invalid_client' ||
    code === 'application_cannot_be_found' ||
    code === 'unauthorized_client' ||
    code === 'invalid_grant'
  );
}
