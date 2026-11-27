/**
 * Seed data and input builder tests (#3983)
 *
 * The seed runs against a real store with no dry run, so a broken barcode, an
 * order line naming a SKU the catalogue does not have, or stock sent for an
 * untracked variant would only surface as a failed run half-way through.
 *
 * Run: node --test docker/shopify/lib  (also part of `pnpm check:invariants`)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ORDERS,
  PRODUCTS,
  buildOrderInput,
  buildProductSetInput,
  ean13,
  includedTax,
  orderTag,
} from './seed-catalogue.mjs';
import { readConfig } from './shopify-client.mjs';

function isValidEan13(code) {
  const digits = code.split('').map(Number);
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return code.length === 13 && (10 - (sum % 10)) % 10 === digits[12];
}

describe('ean13', () => {
  it('should append the GS1 check digit', () => {
    assert.equal(ean13('590123412345'), '5901234123457');
  });

  it('should refuse a body that is not 12 digits', () => {
    assert.throws(() => ean13('59012'));
  });
});

describe('catalogue', () => {
  it('should give every barcode a valid check digit and keep SKUs unique', () => {
    const variants = PRODUCTS.flatMap((p) => p.variants);
    for (const v of variants) {
      if (v.barcode !== null) assert.ok(isValidEan13(v.barcode), `${v.sku}: ${v.barcode}`);
    }
    assert.equal(new Set(variants.map((v) => v.sku)).size, variants.length);
  });

  it('should name only seeded SKUs in the orders', () => {
    const skus = new Set(PRODUCTS.flatMap((p) => p.variants.map((v) => v.sku)));
    for (const order of ORDERS) {
      for (const [sku] of order.lines) assert.ok(skus.has(sku), `${order.key}: ${sku}`);
    }
  });
});

describe('buildProductSetInput', () => {
  it('should split stock across the two locations in order', () => {
    const input = buildProductSetInput(PRODUCTS[0], ['loc-1', 'loc-2'], 'cat-1');

    assert.equal(input.category, 'cat-1');
    assert.deepEqual(input.variants[0].inventoryQuantities, [
      { locationId: 'loc-1', name: 'available', quantity: 12 },
      { locationId: 'loc-2', name: 'available', quantity: 3 },
    ]);
    assert.deepEqual(input.variants[0].optionValues, [{ optionName: 'Size', name: 'S' }]);
  });

  it('should give a single-variant product the Default Title option', () => {
    const mug = PRODUCTS.find((p) => p.handle === 'ol-seed-mug');
    const input = buildProductSetInput(mug, ['a', 'b'], null);

    assert.equal(input.category, undefined);
    assert.deepEqual(input.productOptions, [{ name: 'Title', values: [{ name: 'Default Title' }] }]);
    assert.deepEqual(input.variants[0].optionValues, [{ optionName: 'Title', name: 'Default Title' }]);
  });

  it('should send no stock and tracked false for an untracked variant, and no barcode when there is none', () => {
    const wrap = buildProductSetInput(PRODUCTS.find((p) => p.handle === 'ol-seed-untracked'), ['a', 'b'], null);
    const poster = buildProductSetInput(PRODUCTS.find((p) => p.handle === 'ol-seed-no-barcode'), ['a', 'b'], null);

    assert.equal(wrap.variants[0].inventoryItem.tracked, false);
    assert.equal(wrap.variants[0].inventoryQuantities, undefined);
    assert.equal('barcode' in poster.variants[0], false);
  });
});

describe('buildOrderInput', () => {
  const ids = new Map(PRODUCTS.flatMap((p) => p.variants.map((v) => [v.sku, `gid://shopify/ProductVariant/${v.sku}`])));

  it('should price lines from the catalogue and record a paid sale for the whole gross', () => {
    const paid = buildOrderInput(ORDERS.find((o) => o.key === 'paid'), ids, 'PLN');

    assert.equal(paid.lineItems[1].quantity, 2);
    assert.equal(paid.lineItems[1].priceSet.shopMoney.amount, '39.00');
    // 79.99 + 2 x 39.00 + 12.99 shipping
    assert.deepEqual(paid.transactions, [
      { kind: 'SALE', status: 'SUCCESS', gateway: 'manual', amountSet: { shopMoney: { amount: '170.98', currencyCode: 'PLN' } } },
    ]);
    assert.deepEqual(paid.tags, ['ol-seed', orderTag('paid')]);
  });

  it('should record a pending cash-on-delivery transaction and none for a plain unpaid order', () => {
    const cod = buildOrderInput(ORDERS.find((o) => o.key === 'cod'), ids, 'PLN');
    const unpaid = buildOrderInput(ORDERS.find((o) => o.key === 'unpaid'), ids, 'PLN');

    assert.equal(cod.transactions[0].status, 'PENDING');
    assert.equal(cod.transactions[0].gateway, 'Cash on Delivery (COD)');
    assert.equal(unpaid.transactions, undefined);
  });

  it('should put the company on the address of the B2B order', () => {
    const b2b = buildOrderInput(ORDERS.find((o) => o.key === 'b2b'), ids, 'PLN');

    assert.equal(b2b.shippingAddress.company, 'OL Seed Sp. z o.o.');
  });

  it('should refuse an order whose SKU was not seeded', () => {
    assert.throws(() => buildOrderInput(ORDERS[0], new Map(), 'PLN'), /seed the catalogue first/);
  });
});

describe('includedTax', () => {
  it('should take the tax out of a gross amount', () => {
    assert.ok(Math.abs(includedTax(123, 0.23) - 23) < 1e-9);
  });
});

describe('readConfig', () => {
  it('should strip a scheme and a trailing slash and default the API version', () => {
    const config = readConfig({ SHOPIFY_STORE_DOMAIN: 'https://ol-dev.myshopify.com/', SHOPIFY_ACCESS_TOKEN: 'shpat_x' });

    assert.equal(config.domain, 'ol-dev.myshopify.com');
    assert.equal(config.apiVersion, '2026-10');
  });

  it('should refuse a missing domain and missing credentials', () => {
    assert.throws(() => readConfig({}), /SHOPIFY_STORE_DOMAIN/);
    assert.throws(() => readConfig({ SHOPIFY_STORE_DOMAIN: 'x.myshopify.com', SHOPIFY_CLIENT_ID: 'id' }), /SHOPIFY_ACCESS_TOKEN/);
  });
});
