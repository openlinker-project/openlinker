/**
 * Amazon Response Body
 *
 * Reads a response body as text with a byte ceiling, shared by the LWA token
 * call and the SP-API client. A timeout bounds time, not bytes, and
 * `response.text()` buffers everything before it can be measured, so the body
 * is consumed as a stream and the reader is cancelled once past the limit -
 * which also holds for a chunked response that declares no `content-length`
 * (the `ShoperHttpClient` rule).
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import { AmazonNetworkError } from '../../domain/exceptions/amazon-network.error';

/** Hard ceiling on a buffered response body. */
export const AMAZON_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export async function readAmazonBody(response: Response, maxBytes = AMAZON_MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AmazonNetworkError(`Amazon response is larger than the ${maxBytes}-byte limit`);
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
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AmazonNetworkError(`Amazon response is larger than the ${maxBytes}-byte limit`);
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** `null` for an empty or non-JSON body; never throws. */
export function parseAmazonJson<T>(text: string): T | null {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
