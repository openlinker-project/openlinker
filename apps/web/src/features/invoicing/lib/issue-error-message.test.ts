/**
 * resolveIssueErrorMessage and the issue-error predicates - unit tests (#757, #3863)
 *
 * Every predicate reads the error's stable code and params, never the
 * exception class name in `error`, and the operator never reads server text:
 * a known rejection reads its failure-code copy, anything else the copy
 * `describeApiError` chooses by code.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveIssueErrorMessage,
  isCapabilityDisabledError,
  isConnectionSetupIncompleteError,
  isMissingNumberingSeriesError,
  readAcknowledgementRequest,
  isConnectionSettingError,
  readConnectionSettingErrorCode,
} from './issue-error-message';
import { ApiError } from '../../../shared/api/api-error';
import { getMessages } from '../../../shared/i18n';


/** A message carrying internal identifiers the operator must never see. */
const LEAKY_MESSAGE =
  "Capability 'Invoicing' not enabled for connection conn_abc123 (adapter subiekt-gt)";

function rejection(failureCode: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError('raw', 422, {
    code: 'INVOICE_ISSUE_REJECTED',
    params: { failureCode },
    error: 'InvoiceIssueRejected',
    failureCode,
    ...extra,
  });
}

const codes = (): Record<string, string> => getMessages('errors').codes as Record<string, string>;

describe('resolveIssueErrorMessage', () => {
  it('should read a disabled capability by its code, without the internal ids', () => {
    const error = new ApiError(LEAKY_MESSAGE, 400, {
      code: 'CAPABILITY_NOT_ENABLED',
      params: { connectionId: 'conn_abc123', adapterKey: 'subiekt-gt', capability: 'Invoicing' },
      error: 'CapabilityNotEnabledException',
    });

    const result = resolveIssueErrorMessage(error);

    expect(result).toBe(codes().CAPABILITY_NOT_ENABLED);
    expect(result).not.toContain('conn_abc123');
    expect(result).not.toContain('subiekt-gt');
  });

  it("should read a known rejection's failure-code copy", () => {
    const result = resolveIssueErrorMessage(rejection('buyer-tax-id-invalid'));

    expect(result).not.toBe('raw');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should never echo the server message of an unclassified failure', () => {
    const msg = 'Provider rejected the invoice (correlationId: c-7f3a)';
    const error = new ApiError(msg, 422, { code: 'INVOICE_ISSUE_FAILED', params: { correlationId: 'c-7f3a' } });

    expect(resolveIssueErrorMessage(error)).toBe(codes().INVOICE_ISSUE_FAILED);
  });

  it('should read an already issued document by its code', () => {
    const error = new ApiError('Invoice already issued for order: o1', 409, {
      code: 'INVOICE_ALREADY_ISSUED',
      params: { orderId: 'o1' },
    });

    expect(resolveIssueErrorMessage(error)).toBe(codes().INVOICE_ALREADY_ISSUED);
  });

  it('should use the status family when there is no code, and never echo a network error', () => {
    const forbidden = new ApiError('Forbidden resource', 403, { message: 'Forbidden resource' });
    expect(resolveIssueErrorMessage(forbidden)).toBe(getMessages('errors').status['403']);

    const result = resolveIssueErrorMessage(new Error('socket hang up'));
    expect(result).not.toContain('socket hang up');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('isCapabilityDisabledError', () => {
  it('should be true for either capability code', () => {
    for (const code of ['CAPABILITY_NOT_ENABLED', 'CAPABILITY_NOT_SUPPORTED']) {
      expect(isCapabilityDisabledError(new ApiError('x', 400, { code }))).toBe(true);
    }
  });

  it('should not read the exception class name, another code or a non-API error', () => {
    expect(isCapabilityDisabledError(new ApiError('x', 400, { error: 'CapabilityNotEnabledException' }))).toBe(
      false
    );
    expect(isCapabilityDisabledError(new ApiError('x', 400, { code: 'VALIDATION_FAILED' }))).toBe(false);
    expect(isCapabilityDisabledError(new Error('x'))).toBe(false);
  });
});

describe('isConnectionSetupIncompleteError (#3772)', () => {
  it('should recognise the rejection that names connection-setup-incomplete', () => {
    expect(isConnectionSetupIncompleteError(rejection('connection-setup-incomplete'))).toBe(true);
  });

  it('should not match another failure code, another code, or a non-API error', () => {
    expect(isConnectionSetupIncompleteError(rejection('provider-rejected'))).toBe(false);
    expect(
      isConnectionSetupIncompleteError(
        new ApiError('x', 422, { code: 'INVOICE_ISSUE_FAILED', params: { failureCode: 'connection-setup-incomplete' } })
      )
    ).toBe(false);
    expect(isConnectionSetupIncompleteError(new Error('x'))).toBe(false);
  });
});

describe('isMissingNumberingSeriesError', () => {
  it('should read the code, not the exception name', () => {
    expect(isMissingNumberingSeriesError(new ApiError('x', 400, { code: 'MISSING_NUMBERING_SERIES' }))).toBe(true);
    expect(
      isMissingNumberingSeriesError(new ApiError('x', 400, { error: 'MissingNumberingSeriesException' }))
    ).toBe(false);
  });
});

describe('readAcknowledgementRequest (DEF-23/26)', () => {
  it('should read an acknowledgement-required rejection with its code and the adapter sentence', () => {
    const error = rejection('acknowledgement-required', {
      failureReason: 'The buyer tax number differs from the original invoice.',
      warningCode: 'ksef-buyer-tax-id-change',
    });

    expect(readAcknowledgementRequest(error)).toEqual({
      warningCode: 'ksef-buyer-tax-id-change',
      message: 'The buyer tax number differs from the original invoice.',
    });
  });

  it('should read a cancelled order and say it in the copy for its code', () => {
    const error = new ApiError('This order is cancelled.', 409, {
      code: 'ORDER_CANCELLED',
      params: { warningCode: 'order-cancelled' },
      error: 'OrderNotIssuable',
      warningCode: 'order-cancelled',
    });

    expect(readAcknowledgementRequest(error)).toEqual({
      warningCode: 'order-cancelled',
      message: codes().ORDER_CANCELLED,
    });
  });

  it('should ignore a refusal that is not overrulable', () => {
    const error = new ApiError('already issued', 409, { code: 'ORDER_ALREADY_INVOICED', warningCode: 'x' });
    expect(readAcknowledgementRequest(error)).toBeNull();
  });

  it('should ignore a rejection with another failure code', () => {
    expect(readAcknowledgementRequest(rejection('provider-rejected', { warningCode: 'x' }))).toBeNull();
  });
});

describe('isConnectionSettingError', () => {
  it('should recognise both rejections whose fix is on the connection', () => {
    for (const failureCode of ['connection-setup-incomplete', 'connection-setting-rejected']) {
      expect(isConnectionSettingError(rejection(failureCode))).toBe(true);
    }
  });

  it('should not match an order-side rejection or a non-API error', () => {
    expect(isConnectionSettingError(rejection('provider-rejected'))).toBe(false);
    expect(isConnectionSettingError(new Error('x'))).toBe(false);
  });
});

describe('readConnectionSettingErrorCode', () => {
  it('should name which of the two connection-setting rejections it is', () => {
    for (const failureCode of ['connection-setup-incomplete', 'connection-setting-rejected'] as const) {
      expect(readConnectionSettingErrorCode(rejection(failureCode))).toBe(failureCode);
    }
  });

  it('should return null for an order-side rejection, a class name without a code, or a non-API error', () => {
    expect(readConnectionSettingErrorCode(rejection('provider-rejected'))).toBeNull();
    expect(
      readConnectionSettingErrorCode(
        new ApiError('x', 422, { error: 'InvoiceIssueRejected', failureCode: 'connection-setting-rejected' })
      )
    ).toBeNull();
    expect(readConnectionSettingErrorCode(new Error('x'))).toBeNull();
  });
});
