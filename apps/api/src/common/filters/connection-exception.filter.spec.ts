import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
  ConnectionDisabledException,
  ConnectionInUseException,
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

  it('should return 409 with the reason and the referrers when the connection is still referenced', () => {
    const { host, status, json } = createHost();
    const referrers = [{ id: 'conn-allegro', name: 'Allegro PL' }];

    filter.catch(
      new ConnectionInUseException('conn-3', 'master-catalog-referenced', referrers),
      host
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      error: 'ConnectionInUseException',
      message: expect.stringContaining('"Allegro PL"'),
      reason: 'master-catalog-referenced',
      referrers,
    });
  });
});
