/**
 * A pack-bench parcel worth showing someone (#3340 follow-up)
 *
 * The bench's three seeded parcels each demonstrate the PACKING half and
 * nothing else: no order of theirs carries an invoice, and none carries a
 * shipping label, so the documents panel has only ever been seen in its
 * "nothing to print" state. That is a real state, and it is not the one a
 * packer spends their day in.
 *
 * This seeds ONE order shaped for the whole chain — three lines across two
 * VAT rates, real barcodes, real pictures, a complete Polish address — and
 * then the invoice and the label are bought FOR REAL over the API against
 * the live inFakt and InPost sandbox connections (`issue-client-demo-documents.mjs`).
 * Only the order and its fulfilment work are written directly; every
 * document on it is a genuine provider round-trip.
 *
 * Direct SQL for the order and the work is the same exception
 * `src/support/bench-seed.ts` documents at length: no HTTP endpoint
 * manufactures a `FulfillmentWork`, because one is supposed to arrive
 * through routing + a dispatch handshake.
 *
 *   node seed-client-demo-order.mjs
 */
import pg from 'pg';

const DB = {
  host: process.env.OL_DEMO_PGHOST ?? 'localhost',
  port: Number(process.env.OL_DEMO_PGPORT ?? '35432'),
  user: process.env.OL_DEMO_PGUSER ?? 'postgres',
  password: process.env.OL_DEMO_PGPASSWORD ?? 'postgres',
  database: process.env.OL_DEMO_PGDATABASE ?? 'openlinker',
};

export const DEMO = {
  orderId: 'ol_order_clientdemo00000001',
  workId: 'ol_fulfillmentwork_clientdemo0001',
  orderNumber: 'OL-DEMO-1001',
};

/**
 * Three lines, three barcodes, one VAT rate.
 *
 * All three are sizes of the same fragrance, which is the case barcode
 * scanning exists for: three boxes that look identical on a shelf, tell
 * apart only by the code, and cost between 310 and 551 zloty each. Prices
 * and rates are the shop's own, read from `product_variants`.
 *
 * One rate rather than a mixed basket, because inFakt refuses a `0` rate
 * line in this shape and a demo that cannot issue its invoice demonstrates
 * nothing. Exercising the mixed-rate shipping split is a separate fixture.
 */
const LINES = [
  {
    id: '1001',
    variantId: 'ol_variant_db18877836af4ab79f9279f4dbffab3c',
    productId: 'ol_product_4daa22cba3274ee5aca0bbca6c4453d9',
    name: 'Black Tiger woda toaletowa 50ml',
    sku: 'WOBLACK50',
    price: 309.94,
    taxRate: '23',
    quantity: 2,
  },
  {
    id: '1002',
    variantId: 'ol_variant_62cf583a94f340b0be66bd77ce202933',
    productId: 'ol_product_4daa22cba3274ee5aca0bbca6c4453d9',
    name: 'Black Tiger woda toaletowa 100ml',
    sku: 'WOBLACK100',
    price: 551.02,
    taxRate: '23',
    quantity: 1,
  },
  {
    id: '1003',
    variantId: 'ol_variant_20ce029ba3f14b1789077d37368772ce',
    productId: 'ol_product_4daa22cba3274ee5aca0bbca6c4453d9',
    name: 'Black Tiger woda toaletowa 70ml',
    sku: 'WOBLACK70',
    price: 452.64,
    taxRate: '23',
    quantity: 1,
  },
];

/**
 * The delivery method the order asks for, and the key the carrier is routed
 * by — `fulfillment_routing_rules.source_delivery_method_id`. Change it and
 * the source connection chosen below changes with it.
 */
const SHIPPING_METHOD_ID = 'inpost_paczkomat';

const ADDRESS = {
  firstName: 'Barbara',
  lastName: 'Nowak',
  address1: 'Miodowa 7',
  city: 'Kraków',
  postalCode: '30-001',
  country: 'PL',
};

const TOTAL = LINES.reduce((sum, line) => sum + line.price * line.quantity, 0);

function snapshot() {
  const placedAt = new Date().toISOString();
  return {
    id: DEMO.orderId,
    status: 'processing',
    orderNumber: DEMO.orderNumber,
    placedAt,
    createdAt: placedAt,
    updatedAt: placedAt,
    customerEmail: 'barbara.nowak@example.com',
    billingAddress: ADDRESS,
    shippingAddress: ADDRESS,
    shipping: { methodId: SHIPPING_METHOD_ID, methodName: 'InPost Paczkomat' },
    totals: {
      currency: 'PLN',
      subtotal: Number(TOTAL.toFixed(2)),
      shipping: 0,
      tax: 0,
      total: Number(TOTAL.toFixed(2)),
      // GROSS line prices, which is what the shop quotes and what an invoice
      // needs. OpenLinker refuses to invoice a net-priced order outright
      // (ADR-026 / ADR-063: it never computes or infers tax to convert one),
      // so `'exclusive'` here is not a detail — it is the difference between
      // an order that can carry a fiscal document and one that cannot.
      taxTreatment: 'inclusive',
      totalTaxTreatment: 'inclusive',
    },
    items: LINES.map((line) => ({
      id: line.id,
      sku: line.sku,
      name: line.name,
      price: line.price,
      quantity: line.quantity,
      productId: line.productId,
      variantId: line.variantId,
      taxRate: line.taxRate,
      taxSource: 'shop',
      taxRateCountry: 'PL',
      taxRateReadAt: placedAt,
    })),
  };
}

async function main() {
  const client = new pg.Client(DB);
  await client.connect();

  try {
    // The source connection the order claims to have come from, and the OMS
    // connection holding the work. Both must already exist — this script
    // creates no connections, so it can never invent an integration.
    // The source is chosen BY ITS ROUTING, not by platform.
    // `ShipmentDispatchService` resolves the carrier from a
    // `fulfillment_routing_rules` row keyed on
    // `(source_connection_id, source_delivery_method_id)`; with no matching
    // rule it resolves `omp_fulfilled` — the marketplace ships it — and mints
    // no label at all, answering 200 with nothing in it. So an order seeded
    // against a source that happens to have no rule for its delivery method
    // silently cannot be labelled, which looks like a broken carrier rather
    // than an unconfigured route.
    const { rows: source } = await client.query(
      `SELECT c.id
         FROM fulfillment_routing_rules r
         JOIN connections c ON c.id = r.source_connection_id
        WHERE r.source_delivery_method_id = $1
          AND r.processor_kind = 'ol_managed_carrier'
          AND c.status = 'active'
        ORDER BY r.created_at
        LIMIT 1`,
      [SHIPPING_METHOD_ID]
    );
    const { rows: oms } = await client.query(
      `SELECT id FROM connections WHERE "platformType" = 'openlinker' AND status = 'active'
         AND "enabledCapabilities" @> '["FulfillmentExecutor"]'::jsonb ORDER BY "createdAt" LIMIT 1`
    );
    const { rows: location } = await client.query(
      `SELECT id FROM inventory_locations WHERE status = 'active' ORDER BY "createdAt" LIMIT 1`
    );

    if (source.length === 0) {
      throw new Error(
        `no active connection carries an ol_managed_carrier routing rule for "${SHIPPING_METHOD_ID}" — ` +
          'seed one on the connection Mappings page, or the order cannot be labelled'
      );
    }
    if (oms.length === 0) throw new Error('no active openlinker FulfillmentExecutor connection');
    if (location.length === 0) throw new Error('no active inventory location');

    // Re-seeding replaces rather than accumulates, so a second run leaves one
    // parcel rather than two that differ only in id.
    await client.query(`DELETE FROM fulfillment_work_verifications WHERE "fulfillmentWorkId" = $1`, [DEMO.workId]);
    await client.query(`DELETE FROM fulfillment_work_lines WHERE "fulfillmentWorkId" = $1`, [DEMO.workId]);
    await client.query(`DELETE FROM fulfillment_holds WHERE "fulfillmentWorkId" = $1`, [DEMO.workId]);
    await client.query(`DELETE FROM fulfillment_works WHERE id = $1`, [DEMO.workId]);
    await client.query(`DELETE FROM shipments WHERE "orderId" = $1`, [DEMO.orderId]);
    await client.query(`DELETE FROM invoice_records WHERE "orderId" = $1`, [DEMO.orderId]);
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = $1`, [DEMO.orderId]);

    await client.query(
      // `dispatchByAt` is the ORDER's deadline (#927/#1108), not the work's —
      // `fulfillment_works` carries no such column. Six hours out, so the
      // bench shows a live deadline rather than an overdue one.
      `INSERT INTO order_records
         ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus",
          "placedAt", currency, "totalAmount", "taxTreatment", "dispatchByAt",
          "createdAt", "updatedAt")
       VALUES ($1, $2, $3::jsonb, 'ready', now(), 'PLN', $4, 'inclusive',
               now() + interval '6 hours', now(), now())`,
      [DEMO.orderId, source[0].id, JSON.stringify(snapshot()), TOTAL.toFixed(2)]
    );

    await client.query(
      `INSERT INTO fulfillment_works
         (id, "orderId", "locationId", "assignedConnectionId", "deliveryMethod",
          status, "requestStatus", "acceptedAt")
       VALUES ($1, $2, $3, $4, 'courier', 'open', 'accepted', now())`,
      [DEMO.workId, DEMO.orderId, location[0].id, oms[0].id]
    );

    for (const line of LINES) {
      await client.query(
        `INSERT INTO fulfillment_work_lines
           (id, "fulfillmentWorkId", "orderLineId", "productVariantId", "totalQuantity",
            "fulfilledQuantity", "cancelledQuantity")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, 0)`,
        [DEMO.workId, line.id, line.variantId, line.quantity]
      );
    }

    const units = LINES.reduce((sum, line) => sum + line.quantity, 0);
    console.log(`seeded ${DEMO.orderNumber}`);
    console.log(`  order  ${DEMO.orderId}`);
    console.log(`  work   ${DEMO.workId}`);
    console.log(`  ${String(LINES.length)} lines, ${String(units)} units, PLN ${TOTAL.toFixed(2)}`);
    console.log(`  ship to ${ADDRESS.firstName} ${ADDRESS.lastName}, ${ADDRESS.postalCode} ${ADDRESS.city}`);
    console.log('\nnext: node issue-client-demo-documents.mjs');
  } finally {
    await client.end();
  }
}

await main();
