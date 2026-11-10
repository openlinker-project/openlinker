import { HttpException, HttpStatus } from '@nestjs/common';
import { CodedHttpException } from './coded-http.exception';

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
});
