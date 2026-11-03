/**
 * Shoper GPSR Reader - unit tests
 *
 * The request-budget and failure contract: a registry is read only when
 * referenced, at most once per reader, and a failed or dangling reference
 * leaves the product's GPSR unknown instead of failing or fabricating it.
 */
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { ShoperGpsrReader } from '../shoper-gpsr.reader';

const ROUTES: Record<string, unknown[]> = {
  '/product-safety-producers': [
    { gpsr_producer_id: '3', name: 'Acme Sp. z o.o.', country_code: 'PL' },
    { gpsr_producer_id: '4', name: 'Beta GmbH', country_code: 'DE' },
  ],
  '/product-safety-responsibles': [{ gpsr_responsible_id: '1', name: 'EU Rep Ltd' }],
  '/product-safety-importers': [],
  '/product-safety-certificates': [{ gpsr_certificate_id: '9', name: 'CE' }],
};

function setup(routes: Record<string, unknown[]> = ROUTES): { reader: ShoperGpsrReader; get: jest.Mock } {
  const get = jest.fn((path: string) => {
    const list = routes[path];
    if (list === undefined) return Promise.reject(new Error(`unexpected GET ${path}`));
    return Promise.resolve({ status: 200, data: { count: String(list.length), pages: 1, page: 1, list } });
  });
  return { reader: new ShoperGpsrReader({ get } as unknown as ShoperHttpClient, 'conn-1'), get };
}

describe('ShoperGpsrReader', () => {
  it('should make no request when the product references nothing', async () => {
    const { reader, get } = setup();

    const gpsr = await reader.resolve(
      { gpsr_producer_id: null, gpsr_responsible_id: null, gpsr_importer_id: null, gpsr_certificates: [] },
      '93',
    );

    expect(gpsr).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('should make no request and report unknown when the payload has no safety_information', async () => {
    const { reader, get } = setup();

    await expect(reader.resolve(undefined, '93')).resolves.toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it('should read only the registries the product references', async () => {
    const { reader, get } = setup();

    const gpsr = await reader.resolve({ gpsr_producer_id: '3', gpsr_certificates: [9] }, '93');

    expect(gpsr).toEqual({
      producer: { name: 'Acme Sp. z o.o.', address: { countryCode: 'PL' } },
      safetyInformation: { certificateNames: ['CE'] },
    });
    expect(get.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([
      '/product-safety-producers',
      '/product-safety-certificates',
    ]);
    expect(get).toHaveBeenCalledWith('/product-safety-producers', {
      order: 'gpsr_producer_id ASC',
      limit: 50,
      page: 1,
    });
  });

  it('should not read a registry a second time when a second product references the same producer', async () => {
    const { reader, get } = setup();

    await reader.resolve({ gpsr_producer_id: '3' }, '93');
    const second = await reader.resolve({ gpsr_producer_id: '4' }, '94');

    expect(second).toEqual({ producer: { name: 'Beta GmbH', address: { countryCode: 'DE' } } });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should leave gpsr unknown and warn when a registry read fails, without retrying per product', async () => {
    const { reader, get } = setup();
    get.mockImplementation(() => Promise.reject(new Error('503 Service Unavailable')));
    const warn = jest.spyOn((reader as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');

    await expect(reader.resolve({ gpsr_producer_id: '3' }, '93')).resolves.toBeUndefined();
    await expect(reader.resolve({ gpsr_producer_id: '3' }, '94')).resolves.toBeUndefined();

    expect(get).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GPSR registry read failed'));
  });

  it('should leave gpsr unknown and warn when a reference names no record', async () => {
    const { reader } = setup();
    const warn = jest.spyOn((reader as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');

    await expect(reader.resolve({ gpsr_producer_id: '3', gpsr_responsible_id: '77' }, '93')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('responsible person 77'));
  });
});
