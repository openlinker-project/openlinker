import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { CodedHttpException } from '../errors/coded-http.exception';
import { ApiErrorCodeFilter } from './api-error-code.filter';

function createHost(headersSent = false): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status, headersSent }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('ApiErrorCodeFilter', () => {
  const filter = new ApiErrorCodeFilter();

  it('should keep a Nest default body and add the status-family code', () => {
    const { host, status, json } = createHost();

    filter.catch(new NotFoundException('Connection not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      error: 'Not Found',
      message: 'Connection not found',
      code: 'HTTP_404',
    });
  });

  it('should turn a string body into the shape Nest sends, with a code', () => {
    const { host, json } = createHost();

    filter.catch(new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS), host);

    expect(json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many requests',
      code: 'HTTP_429',
    });
  });

  it('should read a legacy code sent in error and keep every other field', () => {
    const { host, json } = createHost();

    filter.catch(
      new ConflictException({
        statusCode: 409,
        error: 'ORDER_ALREADY_ON_HOLD',
        message: 'The order is already on hold.',
        holdId: 'h1',
      }),
      host
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      error: 'ORDER_ALREADY_ON_HOLD',
      message: 'The order is already on hold.',
      holdId: 'h1',
      code: 'ORDER_ALREADY_ON_HOLD',
    });
  });

  it('should leave a code the body already carries untouched', () => {
    const { host, json } = createHost();

    filter.catch(new ConflictException({ code: 'version_conflict', message: 'stale' }), host);

    expect(json).toHaveBeenCalledWith({ code: 'version_conflict', message: 'stale' });
  });

  it('should send a CodedHttpException with its code and params', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new CodedHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'INTERNAL_ERROR', 'english', {
        limit: 3,
      }),
      host
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      statusCode: 422,
      code: 'INTERNAL_ERROR',
      message: 'english',
      params: { limit: 3 },
    });
  });

  it('should keep a validation array message as it is', () => {
    const { host, json } = createHost();

    filter.catch(new BadRequestException(['name should not be empty']), host);

    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'Bad Request',
      message: ['name should not be empty'],
      code: 'HTTP_400',
    });
  });

  it('should answer an unknown error with a generic 500 and never its message', () => {
    const { host, status, json } = createHost();

    filter.catch(new Error('connection string postgres://secret@db'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  it('should answer a thrown non-error value the same way', () => {
    const { host, json } = createHost();

    filter.catch('boom', host);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  });

  it('should not write a response that has already been sent', () => {
    const { host, status } = createHost(true);

    filter.catch(new NotFoundException(), host);
    filter.catch(new Error('late'), host);

    expect(status).not.toHaveBeenCalled();
  });
});
