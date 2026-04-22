import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { CapabilityNotSupportedException, CapabilityNotEnabledException } from '@openlinker/core/integrations';
import { CapabilityNotSupportedFilter } from './capability-not-supported.filter';

function createHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('CapabilityNotSupportedFilter', () => {
  const filter = new CapabilityNotSupportedFilter();

  it('should return 400 when adapter does not support capability', () => {
    const { host, status, json } = createHost();
    const exception = new CapabilityNotSupportedException('prestashop.webservice.v1', 'OfferManager');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'CapabilityNotSupportedException',
      message: expect.stringContaining('does not support capability: OfferManager'),
    });
  });

  it('should return 400 when capability is disabled on connection', () => {
    const { host, status, json } = createHost();
    const exception = new CapabilityNotEnabledException('conn-1', 'prestashop.webservice.v1', 'OfferManager');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'CapabilityNotEnabledException',
      message: expect.stringContaining('disabled'),
    });
  });
});
