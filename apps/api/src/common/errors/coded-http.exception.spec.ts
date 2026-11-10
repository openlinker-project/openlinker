import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { CodedHttpException, codedHttpError } from './coded-http.exception';

describe('CodedHttpException', () => {
  it('should carry its status, code and params in the response body', () => {
    const exception = new CodedHttpException(HttpStatus.CONFLICT, 'INTERNAL_ERROR', 'english', {
      n: 2,
    });

    expect(exception).toBeInstanceOf(HttpException);
    expect(exception.getStatus()).toBe(409);
    expect(exception.getResponse()).toEqual({
      statusCode: 409,
      code: 'INTERNAL_ERROR',
      message: 'english',
      params: { n: 2 },
    });
    expect(exception.code).toBe('INTERNAL_ERROR');
    expect(exception.params).toEqual({ n: 2 });
  });

  it('should leave params out of the body when there are none', () => {
    expect(new CodedHttpException(400, 'HTTP_400', 'bad').getResponse()).toEqual({
      statusCode: 400,
      code: 'HTTP_400',
      message: 'bad',
    });
  });

  it('should keep extra body fields without letting them replace the envelope', () => {
    const exception = new CodedHttpException(
      409,
      'INVOICE_ISSUE_CONTENDED',
      'busy',
      undefined,
      { retryable: true, code: 'OTHER', message: 'other', params: { x: 1 }, statusCode: 500 }
    );

    expect(exception.getResponse()).toEqual({
      statusCode: 409,
      code: 'INVOICE_ISSUE_CONTENDED',
      message: 'busy',
      retryable: true,
    });
  });

  it('should build the Nest exception for the status with the coded body', () => {
    const error = codedHttpError(404, 'INVOICE_NOT_FOUND', 'gone', { invoiceId: 'i-1' });

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      statusCode: 404,
      code: 'INVOICE_NOT_FOUND',
      message: 'gone',
      params: { invoiceId: 'i-1' },
    });
  });

  it('should fall back to CodedHttpException for a status with no Nest class', () => {
    const error = codedHttpError(418, 'INTERNAL_ERROR', 'teapot');

    expect(error).toBeInstanceOf(CodedHttpException);
    expect(error.getStatus()).toBe(418);
  });
});
