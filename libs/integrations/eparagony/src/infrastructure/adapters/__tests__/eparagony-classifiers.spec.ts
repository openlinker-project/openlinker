import { EparagonyApiError } from '../../../domain/exceptions/eparagony-api.error';
import { EparagonyConfigException } from '../../../domain/exceptions/eparagony-config.exception';
import { EparagonyNetworkError } from '../../../domain/exceptions/eparagony-network.error';
import { EparagonyAuthFailureClassifierAdapter } from '../eparagony-auth-failure-classifier.adapter';
import { EparagonyRetryClassifierAdapter } from '../eparagony-retry-classifier.adapter';

describe('EparagonyRetryClassifierAdapter', () => {
  const classifier = new EparagonyRetryClassifierAdapter();

  it('should mark an in-doubt provider failure non-retryable so no sale is registered twice', () => {
    expect(classifier.isNonRetryable(new EparagonyApiError('boom', 503, null))).toBe(true);
  });

  it('should mark a deterministic rejection non-retryable', () => {
    expect(classifier.isNonRetryable(new EparagonyApiError('bad', 400, null))).toBe(true);
  });

  it('should mark a rate limit non-retryable because the create outcome is unknown', () => {
    expect(classifier.isNonRetryable(new EparagonyApiError('slow', 429, null))).toBe(true);
  });

  it('should mark a transport failure non-retryable', () => {
    expect(classifier.isNonRetryable(new EparagonyNetworkError('down'))).toBe(true);
  });

  it('should mark a composition block non-retryable', () => {
    expect(classifier.isNonRetryable(new EparagonyConfigException('bad', 'reason'))).toBe(true);
  });

  it("should abstain for another plugin's error rather than making it terminal", () => {
    // The registry OR-aggregates across plugins with no platform scoping.
    expect(classifier.isNonRetryable(new Error('some other plugin failed'))).toBe(false);
    expect(classifier.isNonRetryable(undefined)).toBe(false);
  });
});

describe('EparagonyAuthFailureClassifierAdapter', () => {
  const classifier = new EparagonyAuthFailureClassifierAdapter();

  it('should flag a 401 as a credential rejection', () => {
    expect(classifier.isCredentialRejected(new EparagonyApiError('nope', 401, null))).toBe(true);
  });

  it('should flag a 403 as a credential rejection because it also covers a scope mismatch', () => {
    expect(classifier.isCredentialRejected(new EparagonyApiError('nope', 403, null))).toBe(true);
  });

  it('should not flag a validation rejection, which says nothing about the credentials', () => {
    expect(classifier.isCredentialRejected(new EparagonyApiError('bad', 400, null))).toBe(false);
  });

  it('should not flag a rate limit or a server error', () => {
    expect(classifier.isCredentialRejected(new EparagonyApiError('slow', 429, null))).toBe(false);
    expect(classifier.isCredentialRejected(new EparagonyApiError('boom', 503, null))).toBe(false);
  });

  it("should abstain for another plugin's error", () => {
    expect(classifier.isCredentialRejected(new Error('elsewhere'))).toBe(false);
  });
});

describe('shared operator-facing copy stays lane-neutral', () => {
  // These three classes are thrown by BOTH `EparagonyFiscalizationAdapter` and
  // `EparagonyInvoicingAdapter` (#3192), so a sentence naming one lane is simply
  // wrong on the other - an OAuth failure during invoice issuance would have
  // read "the e-receipt provider issued no access token", and the poll-budget
  // throw would have said "the sale may or may not have been registered" about
  // an invoice. Nothing else in the tree asserts these strings, which is how
  // they survived the generalisation pass.
  const LANE_SPECIFIC_PHRASES = ['e-receipt', 'the sale may', 'receipt'];

  function assertNeutral(reason: string): void {
    for (const phrase of LANE_SPECIFIC_PHRASES) {
      expect(reason.toLowerCase()).not.toContain(phrase);
    }
  }

  it("should not name a single lane in a transport failure's reason", () => {
    assertNeutral(new EparagonyNetworkError('down').reason);
  });

  it("should not name a single lane in any of the API error's default reasons", () => {
    for (const statusCode of [401, 403, 409, 422, 429, 400, 500, 503]) {
      assertNeutral(new EparagonyApiError('boom', statusCode, null).reason);
    }
  });

  it('should not name a single lane in a composition refusal it was handed', () => {
    // The adapter authors this one, so the class cannot enforce it - the check
    // is here to keep the rule in one readable place.
    assertNeutral(new EparagonyConfigException('bad', 'The provider refused the document.').reason);
  });
});
