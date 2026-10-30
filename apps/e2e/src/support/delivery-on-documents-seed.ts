/**
 * Delivery-on-documents seed (#3912, ADR-079)
 *
 * `tests/delivery-on-documents/` needs an Allegro-like ORDER SOURCE connection
 * paired with a catalogue shop (the Mappings page only reaches its `ready`
 * state through `config.masterCatalogConnectionId`), a handful of ready orders
 * in PL / CZ / HU so the country-facts read behind the "suggest a country"
 * strip has data, and one mixed-rate Polish basket (60.00 @ 23% + 40.00 @ 5%,
 * shipping 15.00) whose shipping splits 9.00 / 6.00. None of that is reachable
 * through the HTTP API on demand, so the rows are written directly - the same
 * deliberate, narrow exception `sales-document-seed.ts` documents.
 *
 * Idempotent: every fixed row is deleted by id first, so a re-run (or a run
 * after a half-finished one) starts from the same shape. The source connection
 * is reset to a FRESH config (no `deliveryOnDocuments` key) every time, which
 * is what makes the first-run state assertable.
 *
 * @module support
 */
import pg from 'pg';
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';
import type { ApiClient } from '../api/api-client';

export const DELIVERY_CONNECTION_IDS = {
  /** Allegro-like order source - the connection whose `deliveryOnDocuments` is under test. */
  source: '39120000-0000-4000-a000-000000000001',
  /** PrestaShop-like catalogue shop the source is paired with. */
  shop: '39120000-0000-4000-a000-000000000002',
  /** Dummy e-receipt connection: only gives Poland a receipt route for the preview. */
  receipt: '39120000-0000-4000-a000-000000000003',
} as const;

export const DELIVERY_SOURCE_NAME = 'Delivery E2E Allegro';
export const DELIVERY_SHOP_NAME = 'Delivery E2E Shop';

/** Fixed order ids; the live spec mints its own per-run ids instead (see `newDeliveryOrderId`). */
export const DELIVERY_ORDER_IDS = {
  plMixed: 'ol_order_d3912seed0001plmixed00',
  plSimple: 'ol_order_d3912seed0002plsimple00',
  plReduced: 'ol_order_d3912seed0003plreduced0',
  cz: 'ol_order_d3912seed0004czech000000',
  hu: 'ol_order_d3912seed0005hungary0000',
} as const;

export interface DeliverySeedItem {
  sku: string;
  name: string;
  quantity: number;
  /** Buyer-paid gross price of ONE unit. */
  unitPriceGross: number;
  /** Percent code as the source reports it, e.g. `'23'`. */
  taxRate: string;
}

export interface DeliverySeedOrder {
  orderId: string;
  country: string;
  items: DeliverySeedItem[];
  /** Gross shipping the buyer paid. */
  shippingGross: number;
  currency?: string;
  city?: string;
}

/** The mixed-rate basket the preview and live specs share. */
export const MIXED_BASKET: Pick<DeliverySeedOrder, 'items' | 'shippingGross'> = {
  items: [
    { sku: 'D3912-A', name: 'Goods at 23', quantity: 1, unitPriceGross: 60, taxRate: '23' },
    { sku: 'D3912-B', name: 'Goods at 5', quantity: 1, unitPriceGross: 40, taxRate: '5' },
  ],
  shippingGross: 15,
};

const SEED_ORDERS: DeliverySeedOrder[] = [
  { orderId: DELIVERY_ORDER_IDS.plMixed, country: 'PL', city: 'Warszawa', ...MIXED_BASKET },
  {
    orderId: DELIVERY_ORDER_IDS.plSimple,
    country: 'PL',
    city: 'Krakow',
    items: [{ sku: 'D3912-C', name: 'Goods at 23', quantity: 2, unitPriceGross: 50, taxRate: '23' }],
    shippingGross: 10,
  },
  {
    orderId: DELIVERY_ORDER_IDS.plReduced,
    country: 'PL',
    city: 'Gdansk',
    items: [{ sku: 'D3912-D', name: 'Goods at 8', quantity: 1, unitPriceGross: 80, taxRate: '8' }],
    shippingGross: 12,
  },
  {
    orderId: DELIVERY_ORDER_IDS.cz,
    country: 'CZ',
    city: 'Praha',
    currency: 'CZK',
    items: [{ sku: 'D3912-E', name: 'Goods at 21', quantity: 1, unitPriceGross: 500, taxRate: '21' }],
    shippingGross: 100,
  },
  {
    orderId: DELIVERY_ORDER_IDS.hu,
    country: 'HU',
    city: 'Budapest',
    currency: 'HUF',
    items: [{ sku: 'D3912-F', name: 'Goods at 27', quantity: 1, unitPriceGross: 9000, taxRate: '27' }],
    shippingGross: 1500,
  },
];

/** A unique, per-run order id (`ol_order_d3912live...`) so a re-run never hits the one-document-per-order guard. */
export function newDeliveryOrderId(tag: string): string {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `ol_order_d3912${tag}${suffix}`;
}

async function withClient<T>(seedName: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  assertSeedableDatabase(seedName);
  const client = new pg.Client({ connectionString: resolveEnv().databaseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Insert one READY order (snapshot + denormalised line rows) for `sourceConnectionId`. */
export async function insertDeliveryOrder(
  client: pg.Client,
  sourceConnectionId: string,
  order: DeliverySeedOrder,
): Promise<void> {
  const currency = order.currency ?? 'PLN';
  const goodsGross = order.items.reduce((sum, i) => sum + i.unitPriceGross * i.quantity, 0);
  const total = goodsGross + order.shippingGross;
  const address = {
    firstName: 'Anna',
    lastName: 'Testowa',
    address1: 'Testowa 1',
    city: order.city ?? 'Warszawa',
    postalCode: '00-001',
    country: order.country,
  };
  const items = order.items.map((item, index) => ({
    id: `${order.orderId}-line-${String(index + 1)}`,
    productId: `ol_product_d3912${item.sku.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    quantity: item.quantity,
    price: item.unitPriceGross,
    unitPriceGross: item.unitPriceGross,
    taxRate: item.taxRate,
    taxSource: 'shop',
    sku: item.sku,
    name: item.name,
  }));
  const snapshot = {
    id: order.orderId,
    status: 'processing',
    orderNumber: order.orderId.slice(-8),
    items,
    totals: {
      subtotal: goodsGross,
      tax: 0,
      shipping: order.shippingGross,
      shippingGross: order.shippingGross,
      total,
      currency,
      taxTreatment: 'inclusive',
    },
    billingAddress: address,
    shippingAddress: address,
    channel: 'allegro',
    placedAt: new Date().toISOString(),
  };
  await client.query(
    `INSERT INTO order_records
       ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt",
        "currency", "totalAmount", "taxTreatment", "createdAt", "updatedAt")
     VALUES ($1, $2, $3::jsonb, 'ready', now(), $4, $5, 'inclusive', now(), now())`,
    [order.orderId, sourceConnectionId, JSON.stringify(snapshot), currency, total],
  );
  for (const [index, item] of items.entries()) {
    await client.query(
      `INSERT INTO order_line_items
         ("orderRecordId", "lineNumber", "productId", quantity, "unitPrice",
          "sourceConnectionId", "placedAt", "taxRate", "taxSource")
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7, 'shop')`,
      [
        order.orderId,
        index,
        item.productId,
        item.quantity,
        item.unitPriceGross,
        sourceConnectionId,
        item.taxRate,
      ],
    );
  }
}

/** Delete orders (and the rows hanging off them) by id. Safe on ids that do not exist. */
export async function deleteDeliveryOrders(orderIds: readonly string[]): Promise<void> {
  if (orderIds.length === 0) return;
  await withClient('deleteDeliveryOrders', async (client) => {
    await client.query(`DELETE FROM fiscal_registration_records WHERE "orderId" = ANY($1::text[])`, [
      orderIds,
    ]);
    await client.query(`DELETE FROM order_line_items WHERE "orderRecordId" = ANY($1::text[])`, [
      orderIds,
    ]);
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      orderIds,
    ]);
  });
}

/**
 * Seed the three connections and the fixed orders. The source starts with a
 * FRESH config - no `deliveryOnDocuments` key - so specs begin at first-run.
 */
export async function seedDeliveryOnDocuments(): Promise<void> {
  await withClient('seedDeliveryOnDocuments', async (client) => {
    await client.query('BEGIN');
    try {
      const orderIds = Object.values(DELIVERY_ORDER_IDS);
      await client.query(
        `DELETE FROM fiscal_registration_records WHERE "orderId" = ANY($1::text[])`,
        [orderIds],
      );
      await client.query(`DELETE FROM order_line_items WHERE "orderRecordId" = ANY($1::text[])`, [
        orderIds,
      ]);
      await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
        orderIds,
      ]);

      await client.query(
        `INSERT INTO connections
           (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities", "adapterKey")
         VALUES
           ($1, 'prestashop', $4, 'active', '{}'::jsonb, 'seed-delivery-shop',
            '["ProductMaster","InventoryMaster","OrderProcessorManager"]'::jsonb, 'prestashop.webservice.v1'),
           ($2, 'allegro', $5, 'active', $6::jsonb, 'seed-delivery-allegro',
            '["OrderSource","OfferManager"]'::jsonb, 'allegro.publicapi.v1'),
           ($3, 'eparagony', 'Delivery E2E receipt (dummy)', 'active',
            '{"salesDocument":{"documentKind":"fiscal-receipt"}}'::jsonb, 'seed-delivery-receipt',
            '["Fiscalization"]'::jsonb, 'eparagony.documents.v3')
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           status = 'active',
           config = EXCLUDED.config,
           "enabledCapabilities" = EXCLUDED."enabledCapabilities",
           "adapterKey" = EXCLUDED."adapterKey"`,
        [
          DELIVERY_CONNECTION_IDS.shop,
          DELIVERY_CONNECTION_IDS.source,
          DELIVERY_CONNECTION_IDS.receipt,
          DELIVERY_SHOP_NAME,
          DELIVERY_SOURCE_NAME,
          JSON.stringify({ masterCatalogConnectionId: DELIVERY_CONNECTION_IDS.shop }),
        ],
      );

      for (const order of SEED_ORDERS) {
        await insertDeliveryOrder(client, DELIVERY_CONNECTION_IDS.source, order);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/**
 * Give Poland a fiscal-receipt route to the dummy receipt connection, so the
 * order panel resolves `fiscal-receipt` and previews receipt wording (names
 * carry the rate) rather than invoice wording.
 */
export async function routePolandToDummyReceipt(): Promise<void> {
  await withClient('routePolandToDummyReceipt', async (client) => {
    await client.query(`DELETE FROM sales_document_country_defaults WHERE country = 'PL'`);
    await client.query(
      `INSERT INTO sales_document_country_defaults (country, document_kind, connection_id)
       VALUES ('PL', 'fiscal-receipt', $1)`,
      [DELIVERY_CONNECTION_IDS.receipt],
    );
  });
}

/** Remove the three seeded connections, the fixed orders and the PL route. */
export async function cleanupDeliveryOnDocuments(): Promise<void> {
  await deleteDeliveryOrders(Object.values(DELIVERY_ORDER_IDS));
  await withClient('cleanupDeliveryOnDocuments', async (client) => {
    await client.query(
      `DELETE FROM sales_document_country_defaults WHERE connection_id = $1::uuid`,
      [DELIVERY_CONNECTION_IDS.receipt],
    );
    await client.query(`DELETE FROM connections WHERE id = ANY($1::uuid[])`, [
      Object.values(DELIVERY_CONNECTION_IDS),
    ]);
  });
}

/** Insert extra (per-run) orders for the seeded source. */
export async function seedDeliveryOrders(orders: readonly DeliverySeedOrder[]): Promise<void> {
  await withClient('seedDeliveryOrders', async (client) => {
    for (const order of orders) {
      await insertDeliveryOrder(client, DELIVERY_CONNECTION_IDS.source, order);
    }
  });
}

/**
 * Set the source connection's `deliveryOnDocuments` through the real API.
 *
 * `PATCH /connections/:id` replaces `config` wholesale, so the current config
 * is read back and merged - dropping `masterCatalogConnectionId` here would
 * silently unpair the Mappings page.
 */
export async function setSourceDeliveryConfig(
  api: ApiClient,
  deliveryOnDocuments: Record<string, unknown> | null,
): Promise<void> {
  const current = await api.connections.getById(DELIVERY_CONNECTION_IDS.source);
  const config: Record<string, unknown> = { ...(current.config ?? {}) };
  if (deliveryOnDocuments === null) {
    delete config['deliveryOnDocuments'];
  } else {
    config['deliveryOnDocuments'] = deliveryOnDocuments;
  }
  await api.connections.update(DELIVERY_CONNECTION_IDS.source, { config });
}

/** One settings row as the config stores it (goods mode, plain suffix). */
export function goodsDeliverySettings(name: string): Record<string, unknown> {
  return { name, rate: 'goods', freeDelivery: 'omit', rateFormat: 'plain' };
}
