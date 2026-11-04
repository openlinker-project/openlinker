#!/usr/bin/env node
/**
 * Shopify dev-store seed (#3928)
 *
 * Fills a fresh Shopify development store with the data the capability spike
 * and its end-to-end scenarios need: a second location, a fulfillment service,
 * a small catalogue covering every variant shape OpenLinker cares about, and
 * orders in the states the order flows branch on.
 *
 * Idempotent by marker, not by diff: a product is skipped when its handle
 * exists, an order when its `ol-seed-order-<key>` tag exists, a location or
 * fulfillment service when its name exists. Re-running never edits seeded
 * data, so whatever a probe changed on purpose stays changed.
 *
 * Run: pnpm dev:stack:seed-shopify  (see docker/shopify/README.md)
 */

import { assertNoUserErrors, createClient } from './lib/shopify-client.mjs';

const SEED_TAG = 'ol-seed';
const SECOND_LOCATION_NAME = 'OL Seed Warehouse';
const FULFILLMENT_SERVICE_NAME = 'OL Seed 3PL';
const VAT_RATE = 0.23;

const log = (msg) => process.stdout.write(`[shopify seed] ${msg}\n`);

/** EAN-13 with a valid check digit, from a 12-digit body (590 = Poland). */
function ean13(body12) {
  const digits = body12.split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return body12 + ((10 - (sum % 10)) % 10);
}

const image = (text) => ({
  originalSource: `https://placehold.co/800x800/png?text=${encodeURIComponent(text)}`,
  contentType: 'IMAGE',
});

/**
 * Catalogue shapes, each chosen for a branch in the OpenLinker product/offer
 * flows: multi-option variants, a simple product (synthetic variant), a sale
 * price, zero stock, a missing barcode, and an untracked-inventory item.
 */
const PRODUCTS = [
  {
    handle: 'ol-seed-tshirt',
    title: 'OL Seed T-shirt',
    categorySearch: 'T-shirts',
    vendor: 'OL Seed',
    descriptionHtml: '<p>Cotton T-shirt. <strong>Three sizes</strong>.</p><ul><li>100% cotton</li></ul>',
    options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
    variants: [
      { opts: ['S'], sku: 'OL-SEED-TSHIRT-S', barcode: ean13('590123400001'), price: '79.99', weightKg: 0.2, stock: [12, 3] },
      { opts: ['M'], sku: 'OL-SEED-TSHIRT-M', barcode: ean13('590123400002'), price: '79.99', weightKg: 0.22, stock: [20, 5] },
      { opts: ['L'], sku: 'OL-SEED-TSHIRT-L', barcode: ean13('590123400003'), price: '84.99', weightKg: 0.25, stock: [8, 0] },
    ],
  },
  {
    handle: 'ol-seed-sneakers',
    title: 'OL Seed Sneakers',
    categorySearch: 'Sneakers',
    vendor: 'OL Seed',
    descriptionHtml: '<p>Two colours, two sizes.</p>',
    options: [
      { name: 'Color', values: ['Black', 'White'] },
      { name: 'Size', values: ['42', '43'] },
    ],
    variants: [
      { opts: ['Black', '42'], sku: 'OL-SEED-SNK-BLK-42', barcode: ean13('590123400011'), price: '249.00', compareAtPrice: '299.00', weightKg: 0.9, stock: [4, 2] },
      { opts: ['Black', '43'], sku: 'OL-SEED-SNK-BLK-43', barcode: ean13('590123400012'), price: '249.00', compareAtPrice: '299.00', weightKg: 0.95, stock: [6, 0] },
      { opts: ['White', '42'], sku: 'OL-SEED-SNK-WHT-42', barcode: ean13('590123400013'), price: '249.00', weightKg: 0.9, stock: [0, 0] },
      { opts: ['White', '43'], sku: 'OL-SEED-SNK-WHT-43', barcode: ean13('590123400014'), price: '249.00', weightKg: 0.95, stock: [3, 1] },
    ],
  },
  {
    handle: 'ol-seed-mug',
    title: 'OL Seed Mug',
    categorySearch: 'Mugs',
    vendor: 'OL Seed',
    descriptionHtml: '<p>Ceramic mug, 330 ml.</p>',
    options: null,
    variants: [{ opts: [], sku: 'OL-SEED-MUG', barcode: ean13('590123400021'), price: '39.00', weightKg: 0.4, stock: [50, 10] }],
  },
  {
    handle: 'ol-seed-no-barcode',
    title: 'OL Seed Poster (no barcode)',
    categorySearch: 'Posters',
    vendor: 'OL Seed',
    descriptionHtml: '<p>A product with no EAN, for the missing-barcode paths.</p>',
    options: null,
    variants: [{ opts: [], sku: 'OL-SEED-POSTER', barcode: null, price: '19.90', weightKg: 0.1, stock: [15, 0] }],
  },
  {
    handle: 'ol-seed-untracked',
    title: 'OL Seed Gift Wrap (stock not tracked)',
    categorySearch: 'Gift Wrapping',
    vendor: 'OL Seed',
    descriptionHtml: '<p>Inventory is not tracked for this item.</p>',
    options: null,
    variants: [{ opts: [], sku: 'OL-SEED-WRAP', barcode: ean13('590123400031'), price: '5.00', weightKg: 0.05, stock: null }],
  },
];

const BUYER = {
  firstName: 'Anna',
  lastName: 'Testowa',
  address1: 'ul. Testowa 1',
  city: 'Warszawa',
  zip: '00-001',
  countryCode: 'PL',
  phone: '+48500100200',
};

/**
 * Orders in the states the order flows branch on. `after` runs once the order
 * exists; the dev-store cap (~5 orderCreate per minute) is absorbed by the
 * client's retry, so a full first run takes a minute or two.
 */
const ORDERS = [
  { key: 'paid', lines: [['OL-SEED-TSHIRT-M', 1], ['OL-SEED-MUG', 2]], financial: 'PAID', shipping: ['InPost Paczkomat', 'inpost_locker', '12.99'] },
  { key: 'unpaid', lines: [['OL-SEED-SNK-BLK-42', 1]], financial: 'PENDING', shipping: ['Kurier DPD', 'dpd_courier', '19.99'] },
  { key: 'cod', lines: [['OL-SEED-TSHIRT-S', 1]], financial: 'PENDING', gateway: 'Cash on Delivery (COD)', shipping: ['Kurier DPD pobranie', 'dpd_cod', '24.99'] },
  { key: 'b2b', lines: [['OL-SEED-MUG', 10]], financial: 'PAID', company: 'OL Seed Sp. z o.o.', shipping: ['Kurier DPD', 'dpd_courier', '19.99'] },
  { key: 'partial', lines: [['OL-SEED-TSHIRT-L', 1], ['OL-SEED-POSTER', 1]], financial: 'PAID', shipping: ['InPost Kurier', 'inpost_courier', '14.99'], after: 'fulfil-first-line' },
  { key: 'cancelled', lines: [['OL-SEED-SNK-WHT-43', 1]], financial: 'PAID', shipping: ['InPost Paczkomat', 'inpost_locker', '12.99'], after: 'cancel' },
];

function money(amount, currencyCode) {
  return { shopMoney: { amount: Number(amount).toFixed(2), currencyCode } };
}

/** Tax contained in a gross amount: gross - gross / (1 + rate). */
function includedTax(gross, rate) {
  return gross - gross / (1 + rate);
}

async function main() {
  const shopify = await createClient();
  log(`endpoint ${shopify.endpoint}`);

  // `location` with no id is the shop's PRIMARY location: the one warehouse
  // OpenLinker works with until a WMS exists (spike #3928 decision). The first
  // entry of `locations` is not guaranteed to be it.
  const shopRes = await shopify.request(`{ shop { name currencyCode taxesIncluded } location { id name } locations(first: 20) { nodes { id name } } }`);
  const { shop, location, locations } = shopRes.data;
  log(`shop "${shop.name}", currency ${shop.currencyCode}, taxesIncluded=${shop.taxesIncluded}`);
  if (shop.currencyCode !== 'PLN') {
    log(`WARNING: store currency is ${shop.currencyCode}, not PLN. See README step 2 - change it before the first order exists.`);
  }

  const primaryLocation = location;
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
  const variants = product.variants.map((v) => ({
    ...(product.options
      ? { optionValues: v.opts.map((name, i) => ({ optionName: product.options[i].name, name })) }
      : {}),
    sku: v.sku,
    ...(v.barcode ? { barcode: v.barcode } : {}),
    price: v.price,
    ...(v.compareAtPrice ? { compareAtPrice: v.compareAtPrice } : {}),
    taxable: true,
    inventoryItem: {
      tracked: v.stock !== null,
      measurement: { weight: { value: v.weightKg, unit: 'KILOGRAMS' } },
    },
    ...(v.stock
      ? {
          inventoryQuantities: v.stock.map((quantity, i) => ({
            locationId: locationIds[i],
            name: 'available',
            quantity,
          })),
        }
      : {}),
  }));

  const input = {
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    descriptionHtml: product.descriptionHtml,
    status: 'ACTIVE',
    tags: [SEED_TAG],
    ...(category ? { category } : {}),
    // Shopify requires productOptions even for a single-variant product.
    productOptions: product.options
      ? product.options.map((o) => ({ name: o.name, values: o.values.map((name) => ({ name })) }))
      : [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    variants: product.options
      ? variants
      : variants.map((v) => ({ ...v, optionValues: [{ optionName: 'Title', name: 'Default Title' }] })),
    files: [image(product.title)],
  };

  const res = await shopify.request(
    `mutation ($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { id handle variants(first: 10) { nodes { sku } } }
        userErrors { field message code }
      }
    }`,
    { input },
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
  const tag = `${SEED_TAG}-order-${spec.key}`;
  // Tag search shares the index lag above, so re-running within seconds of a
  // first run can duplicate an order. Wait a minute between runs.
  const existing = await shopify.request(
    `query ($q: String!) { orders(first: 1, query: $q) { nodes { id name } } }`,
    { q: `tag:'${tag}'` },
  );
  if (existing.data.orders.nodes.length) {
    log(`order ${spec.key} exists (${existing.data.orders.nodes[0].name})`);
    return;
  }

  const priceBySku = new Map(PRODUCTS.flatMap((p) => p.variants.map((v) => [v.sku, Number(v.price)])));
  let gross = 0;
  const lineItems = spec.lines.map(([sku, quantity]) => {
    const variantId = variantIdsBySku.get(sku);
    if (!variantId) throw new Error(`order ${spec.key}: no variant for ${sku}, seed the catalogue first`);
    const unit = priceBySku.get(sku);
    gross += unit * quantity;
    return {
      variantId,
      quantity,
      priceSet: money(unit, currencyCode),
      taxLines: [{ title: 'VAT 23%', rate: VAT_RATE, priceSet: money(includedTax(unit * quantity, VAT_RATE), currencyCode) }],
    };
  });
  const [shippingTitle, shippingCode, shippingPrice] = spec.shipping;
  gross += Number(shippingPrice);

  const address = { ...BUYER, ...(spec.company ? { company: spec.company } : {}) };
  const order = {
    email: `anna.testowa+${spec.key}@example.com`,
    phone: BUYER.phone,
    shippingAddress: address,
    billingAddress: address,
    lineItems,
    shippingLines: [{ title: shippingTitle, code: shippingCode, priceSet: money(shippingPrice, currencyCode) }],
    taxesIncluded: true,
    financialStatus: spec.financial,
    tags: [SEED_TAG, tag],
    note: `OpenLinker seed order (${spec.key})`,
    ...(spec.financial === 'PAID'
      ? { transactions: [{ kind: 'SALE', status: 'SUCCESS', gateway: 'manual', amountSet: money(gross, currencyCode) }] }
      : {}),
    ...(spec.gateway
      ? { transactions: [{ kind: 'SALE', status: 'PENDING', gateway: spec.gateway, amountSet: money(gross, currencyCode) }] }
      : {}),
  };

  const res = await shopify.request(
    `mutation ($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        order { id name fulfillmentOrders(first: 5) { nodes { id lineItems(first: 10) { nodes { id remainingQuantity lineItem { sku } } } } } }
        userErrors { field message }
      }
    }`,
    { order, options: { inventoryBehaviour: 'DECREMENT_OBEYING_POLICY', sendReceipt: false, sendFulfillmentReceipt: false } },
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
  const res = await shopify.request(
    `mutation ($orderId: ID!) {
      orderCancel(orderId: $orderId, reason: CUSTOMER, refund: false, restock: true, notifyCustomer: false) {
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
