#!/usr/bin/env node
/**
 * Shopify dev-store seed (#3928, #3983)
 *
 * Fills a Shopify development store with the data OpenLinker's flows need: a
 * second location, a fulfillment service, a small catalogue covering every
 * variant shape OpenLinker cares about, and orders in the states the order
 * flows branch on. The data and inputs live in `lib/seed-catalogue.mjs`.
 *
 * Idempotent by marker, not by diff: a product is skipped when its handle
 * exists, an order when its `ol-seed-order-<key>` tag exists, a location or
 * fulfillment service when its name exists. Re-running never edits seeded
 * data, so whatever a test changed on purpose stays changed.
 *
 * Run: pnpm dev:stack:seed-shopify  (see docker/shopify/README.md)
 */

import {
  FULFILLMENT_SERVICE_NAME,
  ORDERS,
  PRODUCTS,
  SECOND_LOCATION_NAME,
  buildOrderInput,
  buildProductSetInput,
  orderTag,
} from './lib/seed-catalogue.mjs';
import { assertNoUserErrors, createClient } from './lib/shopify-client.mjs';

const log = (msg) => process.stdout.write(`[shopify seed] ${msg}\n`);

async function main() {
  const shopify = await createClient();
  log(`endpoint ${shopify.endpoint}`);

  // `location` is the shop's primary location - the one OpenLinker uses when a
  // connection names none. `locations` order is not guaranteed to put it first.
  const shopRes = await shopify.request(
    `{ shop { name currencyCode taxesIncluded } location { id name } locations(first: 20) { nodes { id name } } }`,
  );
  const { shop, location: primaryLocation, locations } = shopRes.data;
  log(`shop "${shop.name}", currency ${shop.currencyCode}, taxesIncluded=${shop.taxesIncluded}`);
  if (shop.currencyCode !== 'PLN') {
    log(`note: store currency is ${shop.currencyCode}, not PLN. Fine for most tests; see README step 1.`);
  }
  if (!primaryLocation) throw new Error('the shop reports no primary location');

  const secondLocation = await ensureLocation(shopify, locations.nodes);
  await ensureFulfillmentService(shopify);

  for (const product of PRODUCTS) {
    await ensureProduct(shopify, product, [primaryLocation.id, secondLocation.id]);
  }

  const variantIdsBySku = await readVariantIds(shopify);
  for (const order of ORDERS) {
    await ensureOrder(shopify, order, variantIdsBySku, shop.currencyCode);
  }

  log('done');
}

async function ensureLocation(shopify, existing) {
  const found = existing.find((l) => l.name === SECOND_LOCATION_NAME);
  if (found) {
    log(`location "${SECOND_LOCATION_NAME}" exists`);
    return found;
  }
  const res = await shopify.request(
    `mutation ($input: LocationAddInput!) { locationAdd(input: $input) { location { id name } userErrors { field message } } }`,
    {
      input: {
        name: SECOND_LOCATION_NAME,
        address: { address1: 'ul. Magazynowa 5', city: 'Poznan', zip: '60-001', countryCode: 'PL' },
        fulfillsOnlineOrders: true,
      },
    },
    { userErrorsPath: 'locationAdd' },
  );
  assertNoUserErrors(res.data.locationAdd, 'locationAdd');
  log(`location "${SECOND_LOCATION_NAME}" created`);
  return res.data.locationAdd.location;
}

async function ensureFulfillmentService(shopify) {
  const res = await shopify.request(`{ shop { fulfillmentServices { id serviceName } } }`);
  if (res.data.shop.fulfillmentServices.some((s) => s.serviceName === FULFILLMENT_SERVICE_NAME)) {
    log(`fulfillment service "${FULFILLMENT_SERVICE_NAME}" exists`);
    return;
  }
  // No callbackUrl: it is optional on 2026-10, and Shopify refuses one outside
  // the app's own URL domain ("Callback url is not allowed"). A real 3PL
  // connection needs a public OpenLinker URL under that domain (#3928, L-F1).
  const created = await shopify.request(
    `mutation ($name: String!) {
      fulfillmentServiceCreate(name: $name, trackingSupport: true, inventoryManagement: true) {
        fulfillmentService { id serviceName location { id } }
        userErrors { field message }
      }
    }`,
    { name: FULFILLMENT_SERVICE_NAME },
    { userErrorsPath: 'fulfillmentServiceCreate' },
  );
  assertNoUserErrors(created.data.fulfillmentServiceCreate, 'fulfillmentServiceCreate');
  log(`fulfillment service "${FULFILLMENT_SERVICE_NAME}" created`);
}

async function findCategoryId(shopify, search) {
  const res = await shopify.request(
    `query ($search: String!) { taxonomy { categories(first: 1, search: $search) { nodes { id fullName } } } }`,
    { search },
  );
  const node = res.data.taxonomy.categories.nodes[0];
  return node ? node.id : null;
}

async function ensureProduct(shopify, product, locationIds) {
  // productByIdentifier reads the product directly; the `query:` search index
  // lags writes by seconds and returns a partial set in between (#3928, L-M1).
  const existing = await shopify.request(
    `query ($handle: String!) { productByIdentifier(identifier: { handle: $handle }) { id } }`,
    { handle: product.handle },
  );
  if (existing.data.productByIdentifier) {
    log(`product ${product.handle} exists`);
    return;
  }

  const category = await findCategoryId(shopify, product.categorySearch);
  const res = await shopify.request(
    `mutation ($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id handle variants(first: 10) { nodes { sku } } }
        userErrors { field message code }
      }
    }`,
    { input: buildProductSetInput(product, locationIds, category) },
    { userErrorsPath: 'productSet' },
  );
  assertNoUserErrors(res.data.productSet, `productSet ${product.handle}`);
  log(`product ${product.handle} created (${product.variants.length} variant(s), category ${category ? 'set' : 'none found'})`);
}

async function readVariantIds(shopify) {
  const bySku = new Map();
  for (const product of PRODUCTS) {
    const res = await shopify.request(
      `query ($handle: String!) {
        productByIdentifier(identifier: { handle: $handle }) { variants(first: 50) { nodes { id sku } } }
      }`,
      { handle: product.handle },
    );
    for (const v of res.data.productByIdentifier?.variants.nodes ?? []) bySku.set(v.sku, v.id);
  }
  return bySku;
}

async function ensureOrder(shopify, spec, variantIdsBySku, currencyCode) {
  // Tag search shares the index lag above, so re-running within seconds of a
  // first run can duplicate an order. Wait a minute between runs.
  const existing = await shopify.request(
    `query ($q: String!) { orders(first: 1, query: $q) { nodes { id name } } }`,
    { q: `tag:'${orderTag(spec.key)}'` },
  );
  if (existing.data.orders.nodes.length) {
    log(`order ${spec.key} exists (${existing.data.orders.nodes[0].name})`);
    return;
  }

  const res = await shopify.request(
    `mutation ($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        order { id name fulfillmentOrders(first: 5) { nodes { id lineItems(first: 10) { nodes { id remainingQuantity lineItem { sku } } } } } }
        userErrors { field message }
      }
    }`,
    {
      order: buildOrderInput(spec, variantIdsBySku, currencyCode),
      options: { inventoryBehaviour: 'DECREMENT_OBEYING_POLICY', sendReceipt: false, sendFulfillmentReceipt: false },
    },
    { userErrorsPath: 'orderCreate' },
  );
  assertNoUserErrors(res.data.orderCreate, `orderCreate ${spec.key}`);
  const created = res.data.orderCreate.order;
  log(`order ${spec.key} created (${created.name})`);

  if (spec.after === 'fulfil-first-line') await fulfilFirstLine(shopify, created, spec);
  if (spec.after === 'cancel') await cancel(shopify, created);
}

async function fulfilFirstLine(shopify, order, spec) {
  const [firstSku] = spec.lines[0];
  const fo = order.fulfillmentOrders.nodes.find((f) => f.lineItems.nodes.some((l) => l.lineItem.sku === firstSku));
  if (!fo) throw new Error(`order ${order.name}: no fulfillment order holds ${firstSku}`);
  const line = fo.lineItems.nodes.find((l) => l.lineItem.sku === firstSku);
  const res = await shopify.request(
    `mutation ($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } }
    }`,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: [{ id: line.id, quantity: 1 }] }],
        trackingInfo: { number: 'OLSEED000000001', company: 'InPost' },
        notifyCustomer: false,
      },
    },
    { userErrorsPath: 'fulfillmentCreate' },
  );
  assertNoUserErrors(res.data.fulfillmentCreate, `fulfillmentCreate ${order.name}`);
  log(`order ${order.name}: first line fulfilled with tracking`);
}

async function cancel(shopify, order) {
  // No `refund` argument: it is deprecated on 2026-10, and leaving out
  // `refundMethod` cancels without refunding, which is what the seed wants.
  const res = await shopify.request(
    `mutation ($orderId: ID!) {
      orderCancel(orderId: $orderId, reason: CUSTOMER, restock: true, notifyCustomer: false, staffNote: "OpenLinker seed") {
        job { id }
        orderCancelUserErrors { field message }
      }
    }`,
    { orderId: order.id },
    { userErrorsPath: 'orderCancel' },
  );
  assertNoUserErrors(res.data.orderCancel, `orderCancel ${order.name}`);
  log(`order ${order.name}: cancellation requested (async job)`);
}

main().catch((error) => {
  process.stderr.write(`[shopify seed] FAILED: ${error.message}\n`);
  process.exit(1);
});
