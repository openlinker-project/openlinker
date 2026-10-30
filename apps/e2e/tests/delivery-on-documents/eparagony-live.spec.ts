/**
 * Delivery line on a LIVE eparagony sandbox receipt (#3912, ADR-079)
 *
 * A fiscal printer binds a line name to one VAT rate and refuses it for good
 * once the rate goes down and then up, so the delivery name must change with
 * the rate. This registers real receipts on the vendor sandbox through the
 * same manual path an operator uses (`POST /fiscal-registrations`) and
 * asserts, from the persisted `fiscalization.register` job payload, that a
 * mixed 23% / 5% basket produced two delivery lines named `<name> 23%` and
 * `<name> 5%` with the gross shipping split 9.00 / 6.00, and that the printer
 * accepted the sale.
 *
 * NEVER use a real delivery name here: a printer locks a name's rate binding
 * permanently. The name is a throwaway `testshiping<epoch>`.
 *
 * Skips without `EPARAGONY_SANDBOX_CLIENT_ID` / `_CLIENT_SECRET` / `_POS_ID`.
 *
 * @module tests/delivery-on-documents
 */
import { test, expect } from '../../src/fixtures/test';
import {
  MIXED_BASKET,
  cleanupDeliveryOnDocuments,
  deleteDeliveryOrders,
  goodsDeliverySettings,
  newDeliveryOrderId,
  seedDeliveryOnDocuments,
  seedDeliveryOrders,
  setSourceDeliveryConfig,
} from '../../src/support/delivery-on-documents-seed';
import {
  createEparagonySandboxConnection,
  readEparagonySandboxCredentials,
  readRegisterJobLines,
  registerAndWait,
} from '../../src/support/eparagony-live';

const credentials = readEparagonySandboxCredentials();
const deliveryName = `testshiping${String(Date.now())}`;
const orderIds: string[] = [];
let receiptConnectionId: string | null = null;

test.describe('delivery line on live eparagony receipts (#3912)', () => {
  test.skip(
    credentials === null,
    'EPARAGONY_SANDBOX_CLIENT_ID / _CLIENT_SECRET / _POS_ID are not set; the live sandbox is unreachable',
  );

  test.beforeAll(async ({ api }) => {
    if (credentials === null) return;
    await seedDeliveryOnDocuments();
    const connection = await createEparagonySandboxConnection(
      api,
      credentials,
      `E2E delivery live ${String(Date.now())}`,
    );
    receiptConnectionId = connection.id;
    // Name the delivery line with the throwaway for Poland AND the default, so
    // whichever row the resolver picks it is never a real name.
    await setSourceDeliveryConfig(api, {
      default: goodsDeliverySettings(deliveryName),
      countries: { PL: goodsDeliverySettings(deliveryName) },
    });
  });

  test.afterAll(async ({ api }) => {
    await deleteDeliveryOrders(orderIds);
    if (receiptConnectionId !== null) {
      await api.connections.update(receiptConnectionId, { status: 'disabled' });
    }
    await cleanupDeliveryOnDocuments();
  });

  test('a mixed 23% / 5% basket registers two rate-named delivery lines and the printer accepts it', async ({
    api,
  }) => {
    test.setTimeout(420_000);
    const orderId = newDeliveryOrderId('mixed');
    orderIds.push(orderId);
    await seedDeliveryOrders([{ orderId, country: 'PL', ...MIXED_BASKET }]);

    const progress = await registerAndWait(api, orderId, receiptConnectionId ?? '');
    expect(progress, 'the fiscal printer accepted the sale').toBe('registered');

    const lines = await readRegisterJobLines(orderId);
    const delivery = lines.filter((line) => line.name.startsWith(deliveryName));
    expect(delivery.map((l) => l.name).sort()).toEqual(
      [`${deliveryName} 23%`, `${deliveryName} 5%`].sort(),
    );
    const byName = new Map(delivery.map((l) => [l.name, l]));
    expect(byName.get(`${deliveryName} 23%`)?.unitPriceGross).toBeCloseTo(9.0, 2);
    expect(byName.get(`${deliveryName} 5%`)?.unitPriceGross).toBeCloseTo(6.0, 2);
    expect(byName.get(`${deliveryName} 23%`)?.taxRate).toBe('23');
    expect(byName.get(`${deliveryName} 5%`)?.taxRate).toBe('5');
  });

  test('a 23%-only basket reuses the 23% name and is still accepted', async ({ api }) => {
    test.setTimeout(420_000);
    const orderId = newDeliveryOrderId('plain');
    orderIds.push(orderId);
    await seedDeliveryOrders([
      {
        orderId,
        country: 'PL',
        items: [
          { sku: 'D3912-G', name: 'Goods at 23', quantity: 1, unitPriceGross: 50, taxRate: '23' },
        ],
        shippingGross: 10,
      },
    ]);

    const progress = await registerAndWait(api, orderId, receiptConnectionId ?? '');
    expect(progress, 'the fiscal printer accepted the sale').toBe('registered');

    const lines = await readRegisterJobLines(orderId);
    const delivery = lines.filter((line) => line.name.startsWith(deliveryName));
    expect(delivery).toHaveLength(1);
    expect(delivery[0]?.name).toBe(`${deliveryName} 23%`);
    expect(delivery[0]?.unitPriceGross).toBeCloseTo(10.0, 2);
  });
});

