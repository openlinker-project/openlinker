/**
 * Subiekt Retry Classifier Adapter — unit tests (#753)
 *
 * Pins the fiscal-safety pivot: an 'indeterminate' transport failure is
 * non-retryable, a proven-'safe' one is retryable.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters/__tests__
 */
import { SubiektRetryClassifierAdapter } from '../subiekt-retry-classifier.adapter';
import { SubiektBridgeTransportError } from '../../../domain/exceptions/subiekt-bridge-transport.exception';
import { SubiektInvoiceRejectedError } from '../../../domain/exceptions/subiekt-invoice-rejected.exception';
import { SubiektUnsupportedDocumentTypeError } from '../../../domain/exceptions/subiekt-unsupported-document-type.exception';
import { SubiektConfigException } from '../../../domain/exceptions/subiekt-config.exception';
import { SubiektBridgeAuthError } from '../../../domain/exceptions/subiekt-bridge-auth.exception';

describe('SubiektRetryClassifierAdapter', () => {
  const classifier = new SubiektRetryClassifierAdapter();

  it('treats a terminal invoice rejection as non-retryable', () => {
    expect(classifier.isNonRetryable(new SubiektInvoiceRejectedError('bad NIP'))).toBe(true);
  });

  it('treats an unsupported document type as non-retryable', () => {
    expect(classifier.isNonRetryable(new SubiektUnsupportedDocumentTypeError('proforma'))).toBe(
      true,
    );
  });

  it('treats a config / SSRF-guard failure as non-retryable', () => {
    expect(classifier.isNonRetryable(new SubiektConfigException('bad url', 'bridgeBaseUrl', 'x'))).toBe(
      true,
    );
  });

  it("treats an 'indeterminate' transport failure as non-retryable (fiscal safety)", () => {
    expect(
      classifier.isNonRetryable(new SubiektBridgeTransportError('timeout', 'indeterminate')),
    ).toBe(true);
  });

  it("treats a proven-'safe' transport failure as retryable", () => {
    expect(
      classifier.isNonRetryable(new SubiektBridgeTransportError('ECONNREFUSED', 'safe')),
    ).toBe(false);
  });

  it('treats a bridge auth failure (401/403) as non-retryable', () => {
    expect(classifier.isNonRetryable(new SubiektBridgeAuthError(401))).toBe(true);
    expect(classifier.isNonRetryable(new SubiektBridgeAuthError(403))).toBe(true);
  });

  it('ABSTAINS (returns false) for non-Subiekt errors so sibling plugins keep their own retry policy', () => {
    // The runner OR-aggregates every plugin's classifier with no platform
    // scoping, so a catch-all `true` here would mark a failed Allegro 5xx / Erli
    // network blip / PrestaShop timeout non-retryable platform-wide. We own only
    // Subiekt types; the fiscal-safe "unknown -> non-retryable" intent is
    // enforced upstream by SubiektInvoicingAdapter wrapping unknowns into a
    // Subiekt-typed 'indeterminate' transport error.
    expect(classifier.isNonRetryable(new Error('boom'))).toBe(false);
    expect(classifier.isNonRetryable(undefined)).toBe(false);
    expect(classifier.isNonRetryable({ weird: true })).toBe(false);
  });
});
