/**
 * KSeF Pre-Submit Refusal Stamp — Unit Specs (DEF-01)
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 */
import { classifyInvoiceFailure } from '@openlinker/core/invoicing';
import { KsefPermissionDeniedException } from '../../../domain/exceptions/ksef-permission-denied.exception';
import { KsefCrossBorderUnsupportedException } from '../../../domain/exceptions/ksef-cross-border-unsupported.exception';
import { KSEF_PERMISSION_DENIED_REASON, stampPreSubmitRefusal } from '../ksef-pre-submit-refusal';

describe('stampPreSubmitRefusal', () => {
  it('should make an unmarked error a re-attemptable rejection instead of in-doubt', () => {
    const error = new Error('session open refused');

    stampPreSubmitRefusal(error);

    expect(classifyInvoiceFailure(error)).toMatchObject({
      failureMode: 'rejected',
      failureCode: 'provider-rejected',
    });
  });

  it('should turn a pre-submit 403 into a connection-setup refusal with the token remedy', () => {
    const error = new KsefPermissionDeniedException('Forbidden');

    stampPreSubmitRefusal(error);

    expect(classifyInvoiceFailure(error)).toEqual({
      failureMode: 'rejected',
      failureCode: 'connection-setup-incomplete',
      failureReason: KSEF_PERMISSION_DENIED_REASON.slice(0, 200),
    });
  });

  it('should leave an error that declares its own failure mode untouched', () => {
    const error = Object.assign(new Error('ambiguous'), { failureMode: 'in-doubt' });

    stampPreSubmitRefusal(error);

    expect(error.failureMode).toBe('in-doubt');
  });

  it('should ignore a non-object throwable', () => {
    expect(() => stampPreSubmitRefusal('boom')).not.toThrow();
  });
});

describe('KsefCrossBorderUnsupportedException (DEF-01)', () => {
  it('should classify as a connection-setup refusal whose reason names no buyer data', () => {
    const error = new KsefCrossBorderUnsupportedException('PL', 'DE');

    const classified = classifyInvoiceFailure(error);

    expect(classified.failureMode).toBe('rejected');
    expect(classified.failureCode).toBe('connection-setup-incomplete');
    expect(classified.failureReason).not.toContain('DE');
    expect(classified.failureReason).toContain('Allow cross-border invoices');
  });
});
