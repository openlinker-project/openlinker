/**
 * Unit tests for PrestashopOrderStateCatalog (#2607)
 *
 * The load-bearing claim these tests defend is that a DEFAULT PrestaShop
 * install still resolves to the ids the removed hardcoded 1-7 table wrote, so
 * upgrading cannot silently move a vanilla shop's orders, while a shop with
 * custom states now resolves by meaning instead of by number.
 */
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import { PrestashopOrderStateCatalog } from '../prestashop-order-state.catalog';
import { DEFAULT_INSTALL_ORDER_STATES } from '../../../__tests__/fixtures/prestashop-order-states.fixture';

const DEFAULT_INSTALL = [
  {
    id: '1',
    name: 'Awaiting cheque payment',
    deleted: '0',
    paid: '0',
    shipped: '0',
    delivered: '0',
  },
  { id: '2', name: 'Payment accepted', deleted: '0', paid: '1', shipped: '0', delivered: '0' },
  {
    id: '3',
    name: 'Processing in progress',
    deleted: '0',
    paid: '1',
    shipped: '0',
    delivered: '0',
  },
  { id: '4', name: 'Shipped', deleted: '0', paid: '1', shipped: '1', delivered: '0' },
  { id: '5', name: 'Delivered', deleted: '0', paid: '1', shipped: '1', delivered: '1' },
  { id: '6', name: 'Canceled', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
  { id: '7', name: 'Refunded', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
];

function clientReturning(rows: unknown[]): {
  client: IPrestashopWebserviceClient;
  listResources: jest.Mock;
} {
  const listResources = jest.fn().mockResolvedValue(rows);
  return {
    client: { listResources } as unknown as IPrestashopWebserviceClient,
    listResources,
  };
}

describe('PrestashopOrderStateCatalog', () => {
  describe('stateIdFor (outbound)', () => {
    it('should resolve the default-install ids when the shop is a default install', async () => {
      const { client } = clientReturning(DEFAULT_INSTALL);
      const states = await new PrestashopOrderStateCatalog(client, 'conn-1').load();

      expect(states.stateIdFor('pending')).toBe(1);
      expect(states.stateIdFor('processing')).toBe(2);
      expect(states.stateIdFor('shipped')).toBe(4);
      expect(states.stateIdFor('delivered')).toBe(5);
      expect(states.stateIdFor('cancelled')).toBe(6);
      expect(states.stateIdFor('refunded')).toBe(7);
    });

    // The no-silent-remap guarantee. A clean install carries 13 states, not 7,
    // and the outbound direction must still pick the same six ids the removed
    // table wrote - otherwise upgrading would move live orders into different
    // states without anyone asking for it.
    it('should resolve the same six ids on a full 13-state clean install', async () => {
      const { client } = clientReturning([...DEFAULT_INSTALL_ORDER_STATES]);
      const states = await new PrestashopOrderStateCatalog(client, 'conn-1').load();

      expect(states.stateIdFor('pending')).toBe(1);
      expect(states.stateIdFor('processing')).toBe(2);
      expect(states.stateIdFor('shipped')).toBe(4);
      expect(states.stateIdFor('delivered')).toBe(5);
      expect(states.stateIdFor('cancelled')).toBe(6);
      expect(states.stateIdFor('refunded')).toBe(7);
    });

    it("should resolve a renumbered shop's own state id rather than the default one", async () => {
      const { client } = clientReturning([
        { id: '18', name: 'Order received', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
        {
          id: '21',
          name: 'Handed to courier',
          deleted: '0',
          paid: '1',
          shipped: '1',
          delivered: '0',
        },
        {
          id: '22',
          name: 'Order cancelled',
          deleted: '0',
          paid: '0',
          shipped: '0',
          delivered: '0',
        },
      ]);
      const states = await new PrestashopOrderStateCatalog(client, 'conn-1').load();

      expect(states.stateIdFor('shipped')).toBe(21);
      expect(states.stateIdFor('cancelled')).toBe(22);
      expect(states.stateIdFor('pending')).toBe(18);
    });

    it('should return null when no state on the shop means the requested status', async () => {
      const { client } = clientReturning([
        {
          id: '1',
          name: 'Awaiting payment',
          deleted: '0',
          paid: '0',
          shipped: '0',
          delivered: '0',
        },
      ]);
      const states = await new PrestashopOrderStateCatalog(client, 'conn-1').load();

      expect(states.stateIdFor('delivered')).toBeNull();
      expect(states.stateIdFor('refunded')).toBeNull();
    });
  });

  describe('statusOf (inbound)', () => {
    it('should read a custom shipped state as shipped instead of pending', async () => {
      const { client } = clientReturning([
        {
          id: '31',
          name: 'Awaiting courier pickup',
          deleted: '0',
          paid: '1',
          shipped: '1',
          delivered: '0',
        },
      ]);
      const states = await new PrestashopOrderStateCatalog(client, 'conn-1').load();

      expect(states.statusOf('31')).toBe('shipped');
    });

    it('should read a multi-language cancellation label as cancelled', async () => {
      const { client } = clientReturning([
        {
          id: '40',
          name: { language: [{ '#text': 'Anulowane' }, { '#text': 'Canceled' }] },
          deleted: '0',
          paid: '0',
          shipped: '0',
          delivered: '0',
        },
      ]);
      const states = await new PrestashopOrderStateCatalog(client, 'conn-1').load();

      expect(states.statusOf('40')).toBe('cancelled');
    });

    it('should read the paid clean-install states the 1-7 table swept into pending', async () => {
      const { client } = clientReturning([...DEFAULT_INSTALL_ORDER_STATES]);
      const states = await new PrestashopOrderStateCatalog(client, 'conn-1').load();

      // Ids 9 and 11 are flagged paid on a clean install. They used to read
      // `pending`, which said a paid order had not been paid.
      expect(states.statusOf('9')).toBe('processing');
      expect(states.statusOf('11')).toBe('processing');
      // Id 8 is a payment error and really is unpaid, so it does not move.
      expect(states.statusOf('8')).toBe('pending');
    });

    it('should return null for an id the shop does not have', async () => {
      const { client } = clientReturning(DEFAULT_INSTALL);
      const states = await new PrestashopOrderStateCatalog(client, 'conn-1').load();

      expect(states.statusOf('99')).toBeNull();
      expect(states.statusOf(undefined)).toBeNull();
    });
  });

  describe('caching', () => {
    it('should read the shop once across repeated loads', async () => {
      const { client, listResources } = clientReturning(DEFAULT_INSTALL);
      const catalog = new PrestashopOrderStateCatalog(client, 'conn-1');

      await Promise.all([catalog.load(), catalog.load()]);
      await catalog.load();

      expect(listResources).toHaveBeenCalledTimes(1);
    });

    it('should retry the shop after a failed read rather than caching an empty catalogue', async () => {
      const listResources = jest
        .fn()
        .mockRejectedValueOnce(new Error('WS down'))
        .mockResolvedValue(DEFAULT_INSTALL);
      const catalog = new PrestashopOrderStateCatalog(
        { listResources } as unknown as IPrestashopWebserviceClient,
        'conn-1'
      );

      await expect(catalog.load()).rejects.toThrow('WS down');
      const states = await catalog.load();

      expect(states.stateIdFor('shipped')).toBe(4);
      expect(listResources).toHaveBeenCalledTimes(2);
    });
  });
});
