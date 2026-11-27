/**
 * Shoper Order Source - OrderFulfillmentReadback (#3365)
 *
 * The shop's own answer to "has this order left", read from the order's status
 * and its parcels. The stubbed shop answers `GET /orders/:id` and `GET /parcels`
 * in the shapes read live from the trial shop (status 7 is the type-3 "sent"
 * status there; every number is a string on the wire).
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import { isOrderFulfillmentReadback } from '@openlinker/core/orders';
import type { OrderSourcePort } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import type { ShoperOrderStatusInfo } from '../../../../domain/types/shoper-order-status.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperOrderReferenceProvider } from '../../../shop-context/shoper-order-reference.provider';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { ShoperOrderSourceAdapter } from '../shoper-order-source.adapter';
import { WARSAW, buildOrderRow } from './shoper-order-source-test-data';

const SENT: ShoperOrderStatusInfo = { type: 3, labels: ['przesyłka wysłana'] };
const NEW: ShoperOrderStatusInfo = { type: 1, labels: ['złożone'] };
const CANCELLED: ShoperOrderStatusInfo = { type: 4, labels: ['anulowane'] };
const RETURNED: ShoperOrderStatusInfo = { type: 4, labels: ['zwrot'] };

interface ShopAnswers {
  readonly order?: () => Promise<unknown>;
  readonly parcels?: () => Promise<unknown>;
}

function setup(answers: ShopAnswers = {}, status: ShoperOrderStatusInfo | null = SENT): {
  adapter: ShoperOrderSourceAdapter;
  get: jest.Mock;
  reference: jest.Mocked<Pick<ShoperOrderReferenceProvider, 'getStatus' | 'getShippingName'>>;
} {
  const get = jest.fn((path: string) => {
    if (path === '/orders/2') {
      return answers.order?.() ?? Promise.resolve({ status: 200, data: buildOrderRow() });
    }
    if (path === '/parcels') {
      return answers.parcels?.() ?? Promise.resolve({ status: 200, data: { count: '0', pages: 1, page: 1, list: [] } });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  const reference = {
    getStatus: jest.fn().mockResolvedValue(status),
    getShippingName: jest.fn().mockResolvedValue('Odbiór osobisty'),
  };
  const adapter = new ShoperOrderSourceAdapter(
    { get } as unknown as ShoperHttpClient,
    reference as unknown as ShoperOrderReferenceProvider,
    { get: jest.fn().mockResolvedValue({ timezone: WARSAW }) } as unknown as ShoperShopContextProvider,
    { id: 'conn-1' } as Connection,
  );
  return { adapter, get, reference };
}

function parcels(list: readonly Record<string, unknown>[], pages = 1): () => Promise<unknown> {
  return () => Promise.resolve({ status: 200, data: { count: String(list.length), pages, page: 1, list } });
}

describe('ShoperOrderSourceAdapter.readFulfillment', () => {
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    debug.mockRestore();
  });

  it('should be recognised by the core guard when the adapter is narrowed', () => {
    const { adapter } = setup();

    expect(isOrderFulfillmentReadback(adapter as OrderSourcePort)).toBe(true);
  });

  it('should report a sent order with its waybill when the shop has a sent, tracked parcel', async () => {
    const { adapter, get } = setup({
      parcels: parcels([{ parcel_id: '5', order_id: '2', shipping_id: '8', shipping_code: ' 6200001 ', sent: '1' }]),
    });

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toEqual({
      outcome: 'read',
      rawStatus: '7',
      dispatched: true,
      waybills: [{ waybill: '6200001', carrierId: '8', carrierName: 'Odbiór osobisty' }],
    });
    expect(get).toHaveBeenCalledWith('/parcels', { 'filters[order_id]': '2', limit: 50 });
  });

  it('should report a new order as not dispatched with an empty waybill list when it has no parcels', async () => {
    const { adapter } = setup({}, NEW);

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toEqual({
      outcome: 'read',
      rawStatus: '7',
      dispatched: false,
      waybills: [],
    });
  });

  it('should skip a parcel with no tracking number when listing waybills', async () => {
    const { adapter } = setup({
      parcels: parcels([{ parcel_id: '5', order_id: '2', shipping_id: '8', shipping_code: '', sent: '0' }]),
    });

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({ waybills: [] });
  });

  it('should keep the waybill and drop the carrier name when the shipping lookup fails', async () => {
    const { adapter, reference } = setup({
      parcels: parcels([{ parcel_id: '5', order_id: '2', shipping_id: '8', shipping_code: 'ABC', sent: '1' }]),
    });
    reference.getShippingName.mockRejectedValue(new Error('boom'));

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({
      waybills: [{ waybill: 'ABC', carrierId: '8' }],
    });
  });

  it('should report the status with waybills null when the parcels read fails', async () => {
    const { adapter } = setup({ parcels: () => Promise.reject(new ShoperApiError(500, 'server_error', 'down')) });

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toEqual({
      outcome: 'read',
      rawStatus: '7',
      dispatched: true,
      waybills: null,
    });
  });

  it('should report waybills null when the parcels filter was not honoured', async () => {
    const { adapter } = setup({
      parcels: parcels([{ parcel_id: '9', order_id: '5', shipping_code: 'OTHER', sent: '1' }]),
    });

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({
      outcome: 'read',
      waybills: null,
    });
  });

  it('should report waybills null when the parcels span more than one page', async () => {
    const { adapter } = setup({
      parcels: parcels([{ parcel_id: '5', order_id: '2', shipping_code: 'ABC', sent: '1' }], 2),
    });

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({
      dispatched: true,
      waybills: null,
    });
  });

  it('should report unavailable rather than throw when the order read fails', async () => {
    const { adapter, get } = setup({ order: () => Promise.reject(new ShoperApiError(401, 'unauthorized', 'nope')) });

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({
      outcome: 'unavailable',
      rawStatus: null,
      dispatched: null,
      waybills: null,
    });
    expect(get).not.toHaveBeenCalledWith('/parcels', expect.anything());
  });

  it('should report unavailable when the shop answers with a different order', async () => {
    const { adapter } = setup({
      order: () => Promise.resolve({ status: 200, data: buildOrderRow({ order_id: '3' }) }),
    });

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({ outcome: 'unavailable' });
  });

  it('should report unavailable without a request when the id is not a Shoper order id', async () => {
    const { adapter, get } = setup();

    await expect(adapter.readFulfillment({ externalOrderId: '../x' })).resolves.toMatchObject({
      outcome: 'unavailable',
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('should report dispatched as unknown when the shop does not list the status and no parcel was sent', async () => {
    const { adapter } = setup({}, null);

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toEqual({
      outcome: 'read',
      rawStatus: '7',
      dispatched: null,
      waybills: [],
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('shoper_fulfillment_status_unrecognised'));
  });

  it('should report dispatched as unknown when the status table read fails and no parcel was sent', async () => {
    const { adapter, reference } = setup();
    reference.getStatus.mockRejectedValue(new Error('statuses down'));

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({
      outcome: 'read',
      rawStatus: '7',
      dispatched: null,
    });
  });

  it('should report a cancelled order as not dispatched when no parcel was sent', async () => {
    const { adapter } = setup({}, CANCELLED);

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({ dispatched: false });
  });

  it('should report a returned order as unknown when its parcels could not be read', async () => {
    const { adapter } = setup({ parcels: () => Promise.reject(new Error('down')) }, RETURNED);

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({
      dispatched: null,
      waybills: null,
    });
  });

  it('should report a null raw status when the order names none', async () => {
    const { adapter, reference } = setup({
      order: () => Promise.resolve({ status: 200, data: buildOrderRow({ status_id: null }) }),
    });

    await expect(adapter.readFulfillment({ externalOrderId: '2' })).resolves.toMatchObject({
      rawStatus: null,
      dispatched: null,
    });
    expect(reference.getStatus).not.toHaveBeenCalled();
  });
});
