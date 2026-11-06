/**
 * Shopify Response Body Reader
 *
 * Reads a response body as text with a byte ceiling enforced WHILE reading:
 * `response.text()` buffers everything before it can be measured, and a
 * timeout bounds time, not bytes. Shared by the GraphQL client and the token
 * provider (the Shoper client's approach).
 *
 * @module libs/integrations/shopify/src/infrastructure/http
 */
import { ShopifyNetworkError } from '../../domain/exceptions/shopify-network.error';

/** Hard ceiling on a buffered response body. */
export const SHOPIFY_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export async function readShopifyBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > SHOPIFY_MAX_RESPONSE_BYTES) {
    throw new ShopifyNetworkError(
      `Shopify response is larger than the ${SHOPIFY_MAX_RESPONSE_BYTES}-byte limit`,
    );
  }
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    received += value.byteLength;
    if (received > SHOPIFY_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ShopifyNetworkError(
        `Shopify response is larger than the ${SHOPIFY_MAX_RESPONSE_BYTES}-byte limit`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
}

export function parseShopifyJson<T>(text: string): T | null {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
