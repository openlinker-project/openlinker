/**
 * Invoice Failure Classification Tests (#3772)
 *
 * The classification the service stores and the controller answers with. The
 * cases that matter most are the boundaries of the new opt-in: only a
 * throwable that DECLARES a connection-setup cause reaches the new code, and
 * only that code ever surfaces an adapter-authored sentence.
 */
import {
  CONNECTION_SETUP_FAILURE_CAUSE,
  MAX_FAILURE_REASON_LENGTH,
  classifyInvoiceFailure,
} from './invoice-failure-classification.domain-service';

function rejected(fields: Record<string, unknown>, message = 'refused'): Error {
  return Object.assign(new Error(message), { failureMode: 'rejected', ...fields });
}

describe('classifyInvoiceFailure', () => {
  it('should classify a declared connection-setup refusal and surface its own reason', () => {
    const reason = 'This connection has no seller tax number set, which every invoice requires.';
    expect(
      classifyInvoiceFailure(rejected({ failureCause: CONNECTION_SETUP_FAILURE_CAUSE, reason }))
    ).toEqual({
      failureMode: 'rejected',
      failureCode: 'connection-setup-incomplete',
      failureReason: reason,
    });
  });

  it('should prefer the declaration over wording that would otherwise match a marker', () => {
    // "tax id" is a buyer-tax-id marker; the declaration still wins, because
    // it is a statement from the adapter rather than an inference from text.
    const result = classifyInvoiceFailure(
      rejected({ failureCause: CONNECTION_SETUP_FAILURE_CAUSE, reason: 'No seller tax id set.' })
    );
    expect(result.failureCode).toBe('connection-setup-incomplete');
  });

  it('should fall back to a fixed sentence when a declared refusal carries no usable reason', () => {
    const result = classifyInvoiceFailure(
      rejected({ failureCause: CONNECTION_SETUP_FAILURE_CAUSE, reason: '   ' })
    );
    expect(result.failureCode).toBe('connection-setup-incomplete');
    expect(result.failureReason).toContain('missing a setting');
  });

  it('should bound an over-long adapter reason', () => {
    const result = classifyInvoiceFailure(
      rejected({ failureCause: CONNECTION_SETUP_FAILURE_CAUSE, reason: 'x'.repeat(500) })
    );
    expect(result.failureReason).toHaveLength(MAX_FAILURE_REASON_LENGTH);
  });

  it('should never surface the reason of an undeclared rejection', () => {
    const result = classifyInvoiceFailure(rejected({ reason: 'Buyer Jan Kowalski is blocked' }));
    expect(result).toEqual({
      failureMode: 'rejected',
      failureCode: 'provider-rejected',
      failureReason: 'The invoicing provider rejected the request.',
    });
  });

  it('should ignore a connection-setup cause on a failure that is not a terminal rejection', () => {
    // A declaration cannot make an in-doubt failure safe to retry.
    const error = Object.assign(new Error('timeout'), {
      failureCause: CONNECTION_SETUP_FAILURE_CAUSE,
    });
    expect(classifyInvoiceFailure(error).failureCode).toBe('transport-timeout');
  });

  it('should keep the marker-based codes for undeclared rejections', () => {
    expect(classifyInvoiceFailure(rejected({ reason: 'invalid tax id' })).failureCode).toBe(
      'buyer-tax-id-invalid'
    );
    expect(
      classifyInvoiceFailure(rejected({ reason: 'sale classification missing' })).failureCode
    ).toBe('sale-classification-required');
  });

  it('should treat a plain error as in-doubt', () => {
    expect(classifyInvoiceFailure(new Error('boom'))).toMatchObject({
      failureMode: 'in-doubt',
      failureCode: 'transport-timeout',
    });
  });
});
