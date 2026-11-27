/**
 * Shopify dev-store seed data and input builders (#3928, #3983)
 *
 * Pure: no I/O, so `seed-catalogue.test.mjs` checks the data and the inputs
 * without a store. `seed.mjs` does the reading and writing.
 *
 * Catalogue shapes, each chosen for a branch in the OpenLinker product, stock
 * and offer flows: multi-option variants, a simple product (one variant), a
 * sale price, zero stock, a missing barcode and untracked inventory.
 */

export const SEED_TAG = 'ol-seed';
export const SECOND_LOCATION_NAME = 'OL Seed Warehouse';
export const FULFILLMENT_SERVICE_NAME = 'OL Seed 3PL';
export const VAT_RATE = 0.23;

/** EAN-13 with a valid check digit, from a 12-digit body (590 = Poland). */
export function ean13(body12) {
  if (!/^\d{12}$/.test(body12)) throw new Error(`ean13 needs 12 digits, got "${body12}"`);
  const digits = body12.split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return body12 + ((10 - (sum % 10)) % 10);
}

export const PRODUCTS = [
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

export const BUYER = {
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
 * exists. The dev-store cap (~5 orderCreate a minute) is absorbed by the
 * client's retry, so a full first run takes a minute or two.
 */
export const ORDERS = [
  { key: 'paid', lines: [['OL-SEED-TSHIRT-M', 1], ['OL-SEED-MUG', 2]], financial: 'PAID', shipping: ['InPost Paczkomat', 'inpost_locker', '12.99'] },
  { key: 'unpaid', lines: [['OL-SEED-SNK-BLK-42', 1]], financial: 'PENDING', shipping: ['Kurier DPD', 'dpd_courier', '19.99'] },
  { key: 'cod', lines: [['OL-SEED-TSHIRT-S', 1]], financial: 'PENDING', gateway: 'Cash on Delivery (COD)', shipping: ['Kurier DPD pobranie', 'dpd_cod', '24.99'] },
  { key: 'b2b', lines: [['OL-SEED-MUG', 10]], financial: 'PAID', company: 'OL Seed Sp. z o.o.', shipping: ['Kurier DPD', 'dpd_courier', '19.99'] },
  { key: 'partial', lines: [['OL-SEED-TSHIRT-L', 1], ['OL-SEED-POSTER', 1]], financial: 'PAID', shipping: ['InPost Kurier', 'inpost_courier', '14.99'], after: 'fulfil-first-line' },
  { key: 'cancelled', lines: [['OL-SEED-SNK-WHT-43', 1]], financial: 'PAID', shipping: ['InPost Paczkomat', 'inpost_locker', '12.99'], after: 'cancel' },
];

export function money(amount, currencyCode) {
  return { shopMoney: { amount: Number(amount).toFixed(2), currencyCode } };
}

/** Tax contained in a gross amount: gross - gross / (1 + rate). */
export function includedTax(gross, rate) {
  return gross - gross / (1 + rate);
}

/**
 * `ProductSetInput` for one catalogue product. `locationIds[i]` receives
 * `variant.stock[i]`; an untracked variant gets no quantities at all.
 */
export function buildProductSetInput(product, locationIds, categoryId) {
  const variants = product.variants.map((v) => ({
    optionValues: product.options
      ? v.opts.map((name, i) => ({ optionName: product.options[i].name, name }))
      : [{ optionName: 'Title', name: 'Default Title' }],
    sku: v.sku,
    // `barcode` is deprecated on 2026-10 in favour of `barcodes`, but still
    // accepted; the publisher adapter writes it the same way.
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

  return {
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    descriptionHtml: product.descriptionHtml,
    status: 'ACTIVE',
    tags: [SEED_TAG],
    ...(categoryId ? { category: categoryId } : {}),
    // Shopify requires productOptions even for a single-variant product.
    productOptions: product.options
      ? product.options.map((o) => ({ name: o.name, values: o.values.map((name) => ({ name })) }))
      : [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    variants,
    files: [
      {
        originalSource: `https://placehold.co/800x800/png?text=${encodeURIComponent(product.title)}`,
        contentType: 'IMAGE',
      },
    ],
  };
}

export function orderTag(key) {
  return `${SEED_TAG}-order-${key}`;
}

/** `OrderCreateOrderInput` for one seed order, priced from the catalogue, tax included. */
export function buildOrderInput(spec, variantIdsBySku, currencyCode) {
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
      taxLines: [
        { title: 'VAT 23%', rate: VAT_RATE, priceSet: money(includedTax(unit * quantity, VAT_RATE), currencyCode) },
      ],
    };
  });
  const [shippingTitle, shippingCode, shippingPrice] = spec.shipping;
  gross += Number(shippingPrice);

  const address = { ...BUYER, ...(spec.company ? { company: spec.company } : {}) };
  const transactions =
    spec.financial === 'PAID'
      ? [{ kind: 'SALE', status: 'SUCCESS', gateway: 'manual', amountSet: money(gross, currencyCode) }]
      : spec.gateway
        ? [{ kind: 'SALE', status: 'PENDING', gateway: spec.gateway, amountSet: money(gross, currencyCode) }]
        : undefined;

  return {
    email: `anna.testowa+${spec.key}@example.com`,
    phone: BUYER.phone,
    shippingAddress: address,
    billingAddress: address,
    lineItems,
    shippingLines: [{ title: shippingTitle, code: shippingCode, priceSet: money(shippingPrice, currencyCode) }],
    taxesIncluded: true,
    financialStatus: spec.financial,
    tags: [SEED_TAG, orderTag(spec.key)],
    note: `OpenLinker seed order (${spec.key})`,
    ...(transactions ? { transactions } : {}),
  };
}
