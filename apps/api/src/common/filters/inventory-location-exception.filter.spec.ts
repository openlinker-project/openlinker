import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
  DuplicateLocationCodeError,
  LocationInUseError,
  LocationNotFoundException,
} from '@openlinker/core/inventory';
import { InventoryLocationExceptionFilter } from './inventory-location-exception.filter';

function createHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('InventoryLocationExceptionFilter', () => {
  const filter = new InventoryLocationExceptionFilter();

  it('should return 409 for a duplicate location code', () => {
    const { host, status, json } = createHost();

    filter.catch(new DuplicateLocationCodeError('WH1'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      error: 'DuplicateLocationCodeError',
      message: expect.stringContaining('WH1'),
    });
  });

  it('should return 404 for a missing location', () => {
    const { host, status, json } = createHost();

    filter.catch(new LocationNotFoundException('ol_location_missing'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'LocationNotFoundException',
      message: expect.stringContaining('ol_location_missing'),
    });
  });

  it('should return 409 for a location that still carries positions', () => {
    const { host, status, json } = createHost();

    filter.catch(new LocationInUseError('ol_location_1', 3), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      error: 'LocationInUseError',
      message: expect.stringContaining('3'),
    });
  });
});
