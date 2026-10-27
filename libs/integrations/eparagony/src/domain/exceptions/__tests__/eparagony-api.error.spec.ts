/**
 * EparagonyApiError - classification and operator copy
 *
 * What the operator reads and what core classifies from it. The cases that
 * matter most: a known refusal is matched on the EXACT vendor text and the text
 * is never kept, and an answer that does not settle a document is declared an
 * answer rather than left to read as a timeout.
 *
 * @module libs/integrations/eparagony/src/domain/exceptions/__tests__
 */
import { classifyInvoiceFailure } from '@openlinker/core/invoicing';

import { EparagonyApiError, KNOWN_REJECTIONS } from '../eparagony-api.error';

const MERCHANT_TIN_REASON =
  'The seller tax number on this connection is not the one registered with your eparagony account. Correct it in the connection settings, then retry (code 41).';

describe('EparagonyApiError', () => {
  it('should carry the vendor code in the reason of a plain rejection', () => {
    const error = new EparagonyApiError('bad request', 400, { errorCode: 57 });
    expect(error.failureMode).toBe('rejected');
    expect(error.reason).toBe('The provider rejected the document (code 57).');
    expect(error.failureCause).toBeUndefined();
    expect(error.reasonIsOperatorSafe).toBe(true);
  });

  it('should name the seller tax number for code 41 "Incorrect merchantTIN"', () => {
    const error = new EparagonyApiError('bad request', 400, {
      error: 'Bad Request',
      statusCode: 400,
      errorCode: 41,
      message: 'Incorrect merchantTIN',
    });
    expect(error.reason).toBe(MERCHANT_TIN_REASON);
    expect(error.failureCause).toBe('connection-setting-rejected');
  });

  it('should match the known text regardless of case and surrounding whitespace', () => {
    const error = new EparagonyApiError('bad request', 400, {
      errorCode: 41,
      message: '  incorrect   MERCHANTTIN ',
    });
    expect(error.reason).toBe(MERCHANT_TIN_REASON);
  });

  it('should not treat code 41 alone as a seller tax number problem', () => {
    // The vendor uses 41 for every validation failure, some quoting the
    // submitted document - so only the exact known text selects the copy.
    const error = new EparagonyApiError('bad request', 400, {
      errorCode: 41,
      message: '"documentToken" missing required peer "transactionToken"',
    });
    expect(error.reason).toBe('The provider rejected the document (code 41).');
    expect(error.failureCause).toBeUndefined();
  });

  it('should not match a message that merely contains the known text', () => {
    const error = new EparagonyApiError('bad request', 400, {
      errorCode: 41,
      message: 'Incorrect merchantTIN for buyer Jan Kowalski',
    });
    expect(error.reason).toBe('The provider rejected the document (code 41).');
    expect(error.reason).not.toContain('Kowalski');
  });

  it('should never keep the vendor message anywhere on the error', () => {
    const error = new EparagonyApiError('bad request', 400, {
      errorCode: 41,
      message: 'Incorrect value for line "Red t-shirt"',
    });
    expect(JSON.stringify(error)).not.toContain('Red t-shirt');
    expect(error.reason).not.toContain('Red t-shirt');
  });

  it('should not apply a known refusal to an in-doubt answer', () => {
    const error = new EparagonyApiError('conflict', 409, {
      errorCode: 41,
      message: 'Incorrect merchantTIN',
    });
    expect(error.failureMode).toBe('in-doubt');
    expect(error.reason).not.toBe(MERCHANT_TIN_REASON);
  });

  it('should let an explicit reason win over a known refusal', () => {
    const error = new EparagonyApiError(
      'bad request',
      400,
      { errorCode: 41, message: 'Incorrect merchantTIN' },
      { reason: 'Caller copy.' },
    );
    expect(error.reason).toBe('Caller copy.');
    expect(error.failureCause).toBeUndefined();
  });

  it('should declare an answered in-doubt failure inconclusive, and a request timeout not', () => {
    expect(new EparagonyApiError('replayed', 422, null).failureCause).toBe(
      'provider-answer-inconclusive',
    );
    expect(new EparagonyApiError('server', 503, null).failureCause).toBe(
      'provider-answer-inconclusive',
    );
    expect(new EparagonyApiError('timeout', 408, null).failureCause).toBeUndefined();
  });

  it('should keep every known reason within the length core stores', () => {
    for (const entry of KNOWN_REJECTIONS) {
      expect(entry.reason.length).toBeLessThanOrEqual(200);
      expect(entry.message).toBe(entry.message.trim().toLowerCase());
    }
  });

  describe('as core classifies it', () => {
    it('should reach the record as a refused connection setting with the specific copy', () => {
      const error = new EparagonyApiError('bad request', 400, {
        errorCode: 41,
        message: 'Incorrect merchantTIN',
      });
      expect(classifyInvoiceFailure(error)).toEqual({
        failureMode: 'rejected',
        failureCode: 'connection-setting-rejected',
        failureReason: MERCHANT_TIN_REASON,
      });
    });

    it('should carry the vendor code onto the record of a plain rejection', () => {
      expect(classifyInvoiceFailure(new EparagonyApiError('bad', 400, { errorCode: 57 }))).toEqual({
        failureMode: 'rejected',
        failureCode: 'provider-rejected',
        failureReason: 'The provider rejected the document (code 57).',
      });
    });

    it('should store a 422 as an inconclusive answer, never as a timeout', () => {
      const result = classifyInvoiceFailure(new EparagonyApiError('replayed', 422, null));
      expect(result.failureMode).toBe('in-doubt');
      expect(result.failureCode).toBe('provider-answer-inconclusive');
      expect(result.failureReason).toBe(
        'The provider refused the request as a repeat of an earlier one with different data; it may already hold a document for this sale.',
      );
    });
  });

  it('should name the rejected field in the reason without any value', () => {
    const error = new EparagonyApiError('bad request', 400, {
      errorCode: 57,
      message: 'correctingMetadata.grossSaleValue does not match for Jan Kowalski',
    });
    expect(error.rejectedFields).toEqual(['correctingMetadata.grossSaleValue']);
    expect(error.reason).toBe(
      'The provider rejected the document (code 57). Field: correctingMetadata.grossSaleValue.',
    );
    expect(error.reason).not.toContain('Kowalski');
    expect(classifyInvoiceFailure(error).failureReason).toBe(error.reason);
  });
});
