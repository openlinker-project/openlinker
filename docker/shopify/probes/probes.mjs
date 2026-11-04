/**
 * Probe catalogue for spike #3928
 *
 * One function per question the capability matrix could not answer from the
 * schema alone. Each writes only to the seeded dev store and tags what it
 * creates with `ol-probe`, so probe data is distinguishable from seed data.
 */

const PROBE_TAG = 'ol-probe';

async function variantId(shopify, handle, sku) {
  const res = await shopify.request(
    `query ($handle: String!) { productByIdentifier(identifier: { handle: $handle }) { id updatedAt variants(first: 50) { nodes { id sku price inventoryItem { id } } } } }`,
    { handle },
  );
  const product = res.data.productByIdentifier;
  const variant = product.variants.nodes.find((v) => v.sku === sku);
  return { product, variant };
}

async function pln(shopify) {
  const res = await shopify.request(`{ shop { currencyCode } }`);
  return res.data.shop.currencyCode;
}

function line(variantIdValue, price, currencyCode) {
  return {
    variantId: variantIdValue,
    quantity: 1,
    priceSet: { shopMoney: { amount: price, currencyCode } },
  };
}

const ORDER_CREATE = `mutation ($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { id name sourceIdentifier sourceName purchasingEntity { __typename ... on PurchasingCompany { location { id taxSettings { taxRegistrationId } } } } }
    userErrors { field message }
  }
}`;

export const probes = {
  /** Does `orderCreate` refuse a second order with the same `sourceIdentifier`? Can it be looked up? */
  async 'order-dedup'({ shopify, log, sleep }) {
    const currencyCode = await pln(shopify);
    const { variant } = await variantId(shopify, 'ol-seed-mug', 'OL-SEED-MUG');
    const sourceIdentifier = `ol-probe-dup-${Date.now()}`;
    const order = {
      email: 'probe@example.com',
      lineItems: [line(variant.id, '39.00', currencyCode)],
      financialStatus: 'PENDING',
      taxesIncluded: true,
      sourceIdentifier,
      tags: [PROBE_TAG],
    };
    const options = { inventoryBehaviour: 'BYPASS', sendReceipt: false };
    for (const attempt of ['first', 'second (same sourceIdentifier)']) {
      const res = await shopify.request(ORDER_CREATE, { order, options }, { userErrorsPath: 'orderCreate' });
      log(`orderCreate ${attempt}`, res.data.orderCreate);
    }
    for (const waitS of [0, 10, 30]) {
      if (waitS) await sleep(waitS * 1000);
      const found = await shopify.request(
        `query ($q: String!) { orders(first: 5, query: $q) { nodes { name sourceIdentifier } } }`,
        { q: `source_identifier:${sourceIdentifier}` },
      );
      log(`lookup by source_identifier after ${waitS}s`, found.data.orders.nodes);
    }
  },

  /** Can an app buy a Shopify Shipping label for a Polish store? */
  async 'label-purchase'({ shopify, log }) {
    const res = await shopify.request(
      `{ orders(first: 1, query: "tag:ol-seed-order-paid") { nodes { name fulfillmentOrders(first: 1) { nodes { id status } } } } }`,
    );
    const order = res.data.orders.nodes[0];
    const fo = order.fulfillmentOrders.nodes[0];
    log('fulfillment order', { order: order.name, fo });
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const purchase = await shopify.request(
      `mutation ($input: ShippingLabelPurchaseInput!) {
        shippingLabelPurchase(shippingLabelPurchase: $input) {
          shippingLabelPurchaseResult { id status done errors { __typename } }
          userErrors { field message code }
        }
      }`,
      {
        input: {
          fulfillmentOrderId: fo.id,
          shippingDatetime: tomorrow,
          totalWeight: { value: 1, unit: 'KILOGRAMS' },
          notifyCustomer: false,
        },
      },
    );
    log('shippingLabelPurchase', purchase.data.shippingLabelPurchase);
  },

  /** Does a B2B company location carry the buyer's tax id (NIP) onto an order? */
  async 'buyer-tax-id'({ shopify, log }) {
    const currencyCode = await pln(shopify);
    const created = await shopify.request(
      `mutation ($input: CompanyCreateInput!) {
        companyCreate(input: $input) {
          company { id name locations(first: 1) { nodes { id taxSettings { taxRegistrationId taxExempt } } } }
          userErrors { field message code }
        }
      }`,
      {
        input: {
          company: { name: `OL Probe Firma ${Date.now()}`, externalId: `ol-probe-co-${Date.now()}` },
          companyLocation: {
            name: 'Siedziba',
            taxRegistrationId: 'PL5252556107',
            billingSameAsShipping: true,
            shippingAddress: { address1: 'ul. Firmowa 2', city: 'Warszawa', zip: '00-002', countryCode: 'PL' },
          },
        },
      },
    );
    log('companyCreate', created.data.companyCreate);
    const location = created.data.companyCreate.company?.locations.nodes[0];
    if (!location) return;
    const { variant } = await variantId(shopify, 'ol-seed-mug', 'OL-SEED-MUG');
    const res = await shopify.request(
      ORDER_CREATE,
      {
        order: {
          email: 'b2b-probe@example.com',
          companyLocationId: location.id,
          lineItems: [line(variant.id, '39.00', currencyCode)],
          financialStatus: 'PENDING',
          taxesIncluded: true,
          tags: [PROBE_TAG],
        },
        options: { inventoryBehaviour: 'BYPASS', sendReceipt: false },
      },
      { userErrorsPath: 'orderCreate' },
    );
    log('orderCreate with companyLocationId', res.data.orderCreate);
  },

  /** Does a variant price edit / a stock change bump the product's `updatedAt`? */
  async 'modified-since'({ shopify, log, sleep }) {
    const handle = 'ol-seed-tshirt';
    const sku = 'OL-SEED-TSHIRT-S';
    const before = await variantId(shopify, handle, sku);
    log('before', { productUpdatedAt: before.product.updatedAt, price: before.variant.price });

    await sleep(2000);
    const newPrice = before.variant.price === '79.99' ? '79.98' : '79.99';
    const priced = await shopify.request(
      `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
      }`,
      { productId: before.product.id, variants: [{ id: before.variant.id, price: newPrice }] },
    );
    log('variant price write', priced.data.productVariantsBulkUpdate);
    const afterPrice = await variantId(shopify, handle, sku);
    log('after variant price edit', { productUpdatedAt: afterPrice.product.updatedAt, bumped: afterPrice.product.updatedAt !== before.product.updatedAt });

    await sleep(2000);
    const level = await shopify.request(
      `query ($id: ID!) { inventoryItem(id: $id) { updatedAt inventoryLevels(first: 1) { nodes { location { id } updatedAt quantities(names: ["available"]) { quantity } } } } }`,
      { id: before.variant.inventoryItem.id },
    );
    const node = level.data.inventoryItem.inventoryLevels.nodes[0];
    const current = node.quantities[0].quantity;
    const stock = await shopify.request(
      `mutation ($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) @idempotent(key: "${`ol-probe-stock-${Date.now()}`}") { userErrors { field message code } }
      }`,
      {
        input: {
          name: 'available',
          reason: 'correction',
          quantities: [{ inventoryItemId: before.variant.inventoryItem.id, locationId: node.location.id, quantity: current + 1, changeFromQuantity: current }],
        },
      },
    );
    log('stock write', stock.data.inventorySetQuantities);
    const afterStock = await variantId(shopify, handle, sku);
    const levelAfter = await shopify.request(
      `query ($id: ID!) { inventoryItem(id: $id) { updatedAt inventoryLevels(first: 1) { nodes { updatedAt } } } }`,
      { id: before.variant.inventoryItem.id },
    );
    log('after stock change', {
      productUpdatedAt: afterStock.product.updatedAt,
      productBumped: afterStock.product.updatedAt !== afterPrice.product.updatedAt,
      inventoryItemUpdatedAt: [level.data.inventoryItem.updatedAt, levelAfter.data.inventoryItem.updatedAt],
      inventoryLevelUpdatedAt: [node.updatedAt, levelAfter.data.inventoryItem.inventoryLevels.nodes[0].updatedAt],
    });
  },
  /**
   * Same question as `modified-since`, but each write is isolated and read back
   * after a settle delay, because `updatedAt` itself lags the write (L-M2).
   */
  async 'modified-since-settled'({ shopify, log, sleep }) {
    const handle = 'ol-seed-mug';
    const sku = 'OL-SEED-MUG';
    const SETTLE_MS = 30_000;
    const snapshot = async (label) => {
      const r = await shopify.request(
        `query ($handle: String!) { productByIdentifier(identifier: { handle: $handle }) { updatedAt variants(first: 1) { nodes { id updatedAt price inventoryItem { id updatedAt inventoryLevels(first: 1) { nodes { location { id } updatedAt quantities(names: ["available"]) { quantity updatedAt } } } } } } } }`,
        { handle },
      );
      const p = r.data.productByIdentifier;
      const v = p.variants.nodes[0];
      const l = v.inventoryItem.inventoryLevels.nodes[0];
      const s = { product: p.updatedAt, variant: v.updatedAt, inventoryItem: v.inventoryItem.updatedAt, level: l.updatedAt, available: l.quantities[0].quantity };
      log(label, s);
      return { s, v, l };
    };
    const t0 = await snapshot('t0');
    const stock = await shopify.request(
      `mutation ($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) @idempotent(key: "${`ol-probe-stock2-${Date.now()}`}") { userErrors { field message code } }
      }`,
      { input: { name: 'available', reason: 'correction', quantities: [{ inventoryItemId: t0.v.inventoryItem.id, locationId: t0.l.location.id, quantity: t0.s.available + 1, changeFromQuantity: t0.s.available }] } },
    );
    log(`stock write at ${new Date().toISOString()}`, stock.data.inventorySetQuantities);
    await sleep(SETTLE_MS);
    const t1 = await snapshot('t1 after stock-only change + 30s');
    const priced = await shopify.request(
      `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }`,
      { productId: (await variantId(shopify, handle, sku)).product.id, variants: [{ id: t0.v.id, price: t0.v.price === '39.00' ? '38.99' : '39.00' }] },
    );
    log(`variant price write at ${new Date().toISOString()}`, priced.data.productVariantsBulkUpdate);
    await sleep(SETTLE_MS);
    const t2 = await snapshot('t2 after variant-price-only change + 30s');
    log('verdict', {
      stockChangeBumpsProduct: t1.s.product !== t0.s.product,
      stockChangeBumpsVariant: t1.s.variant !== t0.s.variant,
      stockChangeBumpsLevel: t1.s.level !== t0.s.level,
      variantEditBumpsProduct: t2.s.product !== t1.s.product,
      variantEditBumpsVariant: t2.s.variant !== t1.s.variant,
    });
  },
  /**
   * Follow-up to `buyer-tax-id`: an order on a company location needs a
   * customer, so create the company WITH a contact and associate that customer.
   */
  async 'buyer-tax-id-with-contact'({ shopify, log }) {
    const currencyCode = await pln(shopify);
    const stamp = Date.now();
    const created = await shopify.request(
      `mutation ($input: CompanyCreateInput!) {
        companyCreate(input: $input) {
          company { id mainContact { id customer { id } } locations(first: 1) { nodes { id taxSettings { taxRegistrationId } } } }
          userErrors { field message code }
        }
      }`,
      {
        input: {
          company: { name: `OL Probe Firma B ${stamp}` },
          companyContact: { firstName: 'Jan', lastName: 'Firmowy', email: `jan.firmowy+${stamp}@example.com` },
          companyLocation: {
            name: 'Siedziba',
            taxRegistrationId: 'PL5252556107',
            billingSameAsShipping: true,
            shippingAddress: { address1: 'ul. Firmowa 2', city: 'Warszawa', zip: '00-002', countryCode: 'PL' },
          },
        },
      },
    );
    log('companyCreate', created.data.companyCreate);
    const company = created.data.companyCreate.company;
    if (!company?.mainContact) return;
    const { variant } = await variantId(shopify, 'ol-seed-mug', 'OL-SEED-MUG');
    const res = await shopify.request(
      `mutation ($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
        orderCreate(order: $order, options: $options) {
          order { id name billingAddress { company } purchasingEntity { __typename ... on PurchasingCompany { company { name } location { taxSettings { taxRegistrationId } } } } }
          userErrors { field message }
        }
      }`,
      {
        order: {
          customer: { toAssociate: { id: company.mainContact.customer.id } },
          companyLocationId: company.locations.nodes[0].id,
          lineItems: [line(variant.id, '39.00', currencyCode)],
          financialStatus: 'PENDING',
          taxesIncluded: true,
          tags: [PROBE_TAG],
        },
        options: { inventoryBehaviour: 'BYPASS', sendReceipt: false },
      },
      { userErrorsPath: 'orderCreate' },
    );
    log('orderCreate on company location', res.data.orderCreate);
  },
};
