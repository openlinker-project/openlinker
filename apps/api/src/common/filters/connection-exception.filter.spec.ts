import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
  ConnectionDisabledException,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';
import { ConnectionExceptionFilter } from './connection-exception.filter';

function createHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('ConnectionExceptionFilter', () => {
  const filter = new ConnectionExceptionFilter();

  it('should return 404 for a missing connection', () => {
    const { host, status, json } = createHost();

    filter.catch(new ConnectionNotFoundException('conn-1'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'ConnectionNotFoundException',
      message: expect.stringContaining('conn-1'),
    });
  });

  it('should return 409 for a disabled connection', () => {
    const { host, status, json } = createHost();

    filter.catch(new ConnectionDisabledException('conn-2'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      error: 'ConnectionDisabledException',
      message: expect.stringContaining('disabled'),
    });
  });
});
