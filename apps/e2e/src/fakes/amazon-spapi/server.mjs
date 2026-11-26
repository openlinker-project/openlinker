/**
 * Fake Amazon SP-API + LWA server for the automated Amazon E2E (layer 1).
 *
 * One Node process, four listeners:
 *   4100  LWA token endpoint        (OL_AMAZON_LWA_URL)
 *   4101  SP-API "eu" host          (OL_AMAZON_SPAPI_BASE_URL_EU)
 *   4102  SP-API "na" host          (OL_AMAZON_SPAPI_BASE_URL_NA)
 *   4103  SP-API "fe" host          (OL_AMAZON_SPAPI_BASE_URL_FE)
 *
 * It answers only the endpoints the plugin really calls, with the wire shapes
 * of the Amazon models, and records every request so a test can assert host,
 * port, path, headers and retry count.
 *
 * Control endpoints (any port):
 *   GET  /__calls[?port=&path=&since=]   the call log (secrets never logged)
 *   POST /__reset                        fixtures + failure switches + log
 *   POST /__fail    {kind, count?, path?, port?}   kind: 401 | 429 | 503 | 500 | 400 | 403 | 404 | invalid | lwa
 *                   {clear: true} drops all switches
 *   POST /__state   {orders?, listings?, fbaStock?, returnsReport?}  merge fixtures
 *   GET  /__state                         current fixtures (summary)
 *
 * No secrets are stored: a client secret / refresh token only counts as
 * "present"; the access token is logged as its prefix.
 */
import http from 'node:http';
import { loadContracts, validateRequest, validateResponse } from './contract.mjs';

const PORTS = { lwa: 4100, eu: 4101, na: 4102, fe: 4103 };
const REGION_BY_PORT = { 4101: 'eu', 4102: 'na', 4103: 'fe' };
const SELLER = 'A2EXAMPLE12345';

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const DAY = 24 * 3600 * 1000;
const money = (amount, currencyCode) => ({ amount, currencyCode });

const MARKETS = {
  eu: [
    { id: 'A1C3SOZRARQ6R3', country: 'PL', currency: 'PLN', name: 'Amazon.pl' },
    { id: 'A1PA6795UKMFR9', country: 'DE', currency: 'EUR', name: 'Amazon.de' },
  ],
  na: [{ id: 'ATVPDKIKX0DER', country: 'US', currency: 'USD', name: 'Amazon.com' }],
  fe: [{ id: 'A1VC38T7YXB528', country: 'JP', currency: 'JPY', name: 'Amazon.co.jp' }],
};

function address(country) {
  return {
    name: 'Anna Test',
    addressLine1: 'Teststrasse 1',
    city: 'Testville',
    postalCode: '00-001',
    countryCode: country,
    phone: '+48123456789',
  };
}

function makeOrder(region, market, kind, index) {
  const cur = market.currency;
  const id = `${region === 'eu' ? '302' : region === 'na' ? '111' : '503'}-${market.country}${index}000-${kind.toUpperCase().padEnd(7, '0')}`;
  const created = iso(-(index + 1) * DAY);
  const base = {
    orderId: id,
    createdTime: created,
    lastUpdatedTime: created,
    salesChannel: { channelName: 'AMAZON', marketplaceId: market.id, marketplaceName: market.name },
    buyer: { buyerName: 'Anna Test', buyerEmail: `abc${index}@marketplace.amazon.${market.country.toLowerCase()}` },
    recipient: { deliveryAddress: address(market.country) },
    proceeds: {
      grandTotal: money('44.90', cur),
      breakdowns: [
        { type: 'ITEM', subtotal: money('39.90', cur) },
        { type: 'SHIPPING', subtotal: money('5.00', cur) },
      ],
    },
    payment: { paymentExecutions: [{ paymentMethod: 'CreditCard', paymentAmount: money('44.90', cur) }] },
    fulfillment: {
      fulfillmentStatus: 'UNSHIPPED',
      fulfilledBy: 'MERCHANT',
      fulfillmentServiceLevel: 'STANDARD',
      shipByWindow: { earliestDateTime: created, latestDateTime: iso(-(index + 1) * DAY + 2 * DAY) },
    },
    orderItems: [
      {
        orderItemId: `${index}1111111111111`,
        quantityOrdered: 1,
        product: {
          asin: 'B0FAKE00001',
          title: `Test product ${market.country}`,
          sellerSku: `E2E-${market.country}-1`,
          price: { unitPrice: money('39.90', cur) },
        },
      },
    ],
  };
  const k = {
    plain: {},
    taxid: {
      tax: { taxRegistrations: [{ taxRegistrationNumber: 'PL5252556107', legalName: 'Buyer Sp. z o.o.' }] },
      buyer: { buyerName: 'Buyer Sp. z o.o.', buyerEmail: `biz${index}@marketplace.amazon.${market.country.toLowerCase()}`, buyerCompanyName: 'Buyer Sp. z o.o.' },
    },
    cancelled: { fulfillment: { ...base.fulfillment, fulfillmentStatus: 'CANCELLED' } },
    fba: { fulfillment: { ...base.fulfillment, fulfillmentStatus: 'SHIPPED', fulfilledBy: 'AMAZON' } },
    cod: { payment: { paymentExecutions: [{ paymentMethod: 'CashOnDelivery', paymentAmount: money('44.90', cur) }] } },
    pending: { fulfillment: { ...base.fulfillment, fulfillmentStatus: 'PENDING' } },
    norole: { recipient: undefined },
  }[kind];
  return { ...base, ...k };
}

function makeListing(market, sku, asin, fba = false, qty = 7) {
  return {
    sku,
    summaries: [
      { marketplaceId: market.id, asin, productType: 'LUGGAGE', status: ['BUYABLE'], itemName: `Listing ${sku}`, mainImage: { link: 'https://m.media-amazon.com/images/I/fake.jpg' } },
    ],
    attributes: {
      item_name: [{ value: `Listing ${sku}`, marketplace_id: market.id }],
      externally_assigned_product_identifier: [{ type: 'ean', value: '5901234123457', marketplace_id: market.id }],
    },
    offers: [{ marketplaceId: market.id, offerType: 'B2C', price: money('39.90', market.currency) }],
    fulfillmentAvailability: [{ fulfillmentChannelCode: fba ? 'AMAZON_EU' : 'DEFAULT', quantity: qty }],
    issues: [],
  };
}

function freshFixtures() {
  const fx = { orders: {}, listings: {}, fbaStock: {}, returnsReport: {}, feeds: {}, reports: {}, docs: {}, destinations: [], subscription: null, seq: 0 };
  for (const [region, markets] of Object.entries(MARKETS)) {
    fx.orders[region] = [];
    fx.listings[region] = {};
    fx.fbaStock[region] = {};
    markets.forEach((m, mi) => {
      ['plain', 'taxid', 'cancelled', 'fba', 'cod', 'pending', 'norole'].forEach((kind, i) => {
        fx.orders[region].push(makeOrder(region, m, kind, mi * 10 + i));
      });
      [1, 2].forEach((n) => {
        const sku = `E2E-${m.country}-${n}`;
        fx.listings[region][`${m.id}:${sku}`] = makeListing(m, sku, `B0FAKE0000${n}`);
      });
      const fbaSku = `E2E-${m.country}-FBA`;
      fx.listings[region][`${m.id}:${fbaSku}`] = makeListing(m, fbaSku, 'B0FAKE0000F', true, 0);
      fx.fbaStock[region][fbaSku] = { fulfillableQuantity: 12, reservedQuantity: { totalReservedQuantity: 3 } };
    });
    const m0 = markets[0];
    fx.returnsReport[region] = [
      'Order ID\tOrder date\tReturn request date\tReturn request status\tAmazon RMA ID\tASIN\tMerchant SKU\tItem Name\tReturn quantity\tReturn reason\tOrder Amount\tOrder quantity',
      `${fx.orders[region][0].orderId}\t${iso(-5 * DAY).slice(0, 10)}\t${iso(-2 * DAY)}\tApproved\tRMA-${region}-1\tB0FAKE00001\tE2E-${m0.country}-1\tTest product\t1\tDEFECTIVE\t39.90\t1`,
    ].join('\n');
  }
  return fx;
}

let fx = freshFixtures();
let calls = [];
let switches = [];
let tokenSeq = 0;
let currentToken = null;

function record(entry) {
  calls.push({ at: new Date().toISOString(), ...entry });
  if (calls.length > 5000) calls = calls.slice(-4000);
}

const contracts = loadContracts('/fake/.models');
console.log(contracts ? `contract validation ON (${contracts.length} official models)` : 'contract validation OFF (no models or no ajv)');
let violations = [];

function violation(port, method, path, kind, messages) {
  if (messages.length === 0) return;
  const v = { at: new Date().toISOString(), port, method, path, kind, messages };
  violations.push(v);
  calls.push({ at: v.at, port, method, path, contractViolation: true, kind, messages });
  console.log('CONTRACT VIOLATION', kind, method, path, messages.join(' | '));
}

const json = (res, status, body, headers = {}) => {
  if (res.ctx && !res.ctx.skip && contracts) {
    violation(res.ctx.port, res.ctx.method, res.ctx.pathname, 'response', validateResponse(contracts, res.ctx.method, res.ctx.pathname, status, body));
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'x-amzn-requestid': `fake-${++fx.seq}`, ...headers });
  res.end(text);
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function takeSwitch(port, path, kinds) {
  const idx = switches.findIndex(
    (s) => kinds.includes(s.kind) && (s.port === undefined || s.port === port) && (s.path === undefined || path.includes(s.path)) && (s.count === undefined || s.count > 0),
  );
  if (idx < 0) return null;
  const s = switches[idx];
  if (s.count !== undefined) s.count -= 1;
  s.hits = (s.hits ?? 0) + 1;
  return s;
}

function pageOf(items, query, size) {
  const token = query.get('paginationToken') ?? query.get('pageToken');
  const start = token ? Number(token.replace('tok', '')) : 0;
  const next = start + size < items.length ? `tok${start + size}` : undefined;
  return { slice: items.slice(start, start + size), next };
}

async function control(req, res, url, port) {
  if (url.pathname === '/__calls') {
    const p = url.searchParams.get('port');
    const path = url.searchParams.get('path');
    const since = url.searchParams.get('since');
    const out = calls.filter((c) => (!p || String(c.port) === p) && (!path || c.path.includes(path)) && (!since || c.at >= since));
    return json(res, 200, { calls: out });
  }
  if (url.pathname === '/__violations') {
    return json(res, 200, { enabled: contracts !== null, violations });
  }
  if (url.pathname === '/__reset' && req.method === 'POST') {
    fx = freshFixtures();
    violations = [];
    calls = [];
    switches = [];
    currentToken = null;
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/__fail' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (body.clear) switches = [];
    else switches.push(body);
    return json(res, 200, { switches });
  }
  if (url.pathname === '/__state') {
    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      for (const [region, orders] of Object.entries(body.orders ?? {})) fx.orders[region].push(...orders);
      for (const [region, listings] of Object.entries(body.listings ?? {})) Object.assign(fx.listings[region], listings);
      for (const [region, stock] of Object.entries(body.fbaStock ?? {})) Object.assign(fx.fbaStock[region], stock);
      for (const [region, text] of Object.entries(body.returnsReport ?? {})) fx.returnsReport[region] = text;
      if (body.dropListing) delete fx.listings[body.dropListing.region][body.dropListing.key];
    }
    return json(res, 200, {
      orders: Object.fromEntries(Object.entries(fx.orders).map(([r, o]) => [r, o.map((x) => x.orderId)])),
      listings: Object.fromEntries(Object.entries(fx.listings).map(([r, l]) => [r, Object.keys(l)])),
      switches,
    });
  }
  return null;
}

async function lwa(req, res, url) {
  const raw = await readBody(req);
  const form = new URLSearchParams(raw);
  record({
    port: PORTS.lwa,
    host: req.headers.host,
    method: req.method,
    path: url.pathname,
    grantType: form.get('grant_type'),
    scope: form.get('scope'),
    hasClientSecret: Boolean(form.get('client_secret')),
    hasRefreshToken: Boolean(form.get('refresh_token')),
    clientId: form.get('client_id')?.slice(0, 12),
  });
  if (url.pathname !== '/auth/o2/token' || req.method !== 'POST') return json(res, 404, {});
  if (takeSwitch(PORTS.lwa, url.pathname, ['lwa'])) {
    return json(res, 400, { error: 'invalid_grant', error_description: 'The refresh token is invalid, revoked or expired' });
  }
  currentToken = `fake-token-${++tokenSeq}`;
  return json(res, 200, { access_token: currentToken, token_type: 'bearer', expires_in: 3600, refresh_token: undefined });
}

function filterOrders(region, query) {
  const mk = (query.get('marketplaceIds') ?? '').split(',').filter(Boolean);
  let list = fx.orders[region].filter((o) => mk.length === 0 || mk.includes(o.salesChannel.marketplaceId));
  const la = query.get('lastUpdatedAfter');
  const ca = query.get('createdAfter');
  const cb = query.get('createdBefore');
  if (la) list = list.filter((o) => o.lastUpdatedTime >= la);
  if (ca) list = list.filter((o) => o.createdTime >= ca);
  if (cb) list = list.filter((o) => o.createdTime <= cb);
  return list.sort((a, b) => a.lastUpdatedTime.localeCompare(b.lastUpdatedTime));
}

async function spapi(req, res, url, port) {
  const region = REGION_BY_PORT[port];
  const raw = await readBody(req);
  const token = req.headers['x-amz-access-token'];
  const entry = {
    port,
    region,
    host: req.headers.host,
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    hasAccessToken: typeof token === 'string' && token.length > 0,
    tokenPrefix: typeof token === 'string' ? String(token).slice(0, 11) : null,
    userAgent: req.headers['user-agent'] ?? null,
    contentType: req.headers['content-type'] ?? null,
    body: raw.length > 0 && raw.length < 4000 ? raw : raw.length > 0 ? `[${raw.length} bytes]` : null,
  };

  res.ctx = { port, method: req.method, pathname: url.pathname };
  if (contracts) violation(port, req.method, url.pathname, 'request', validateRequest(contracts, req.method, url.pathname, Object.fromEntries(url.searchParams.entries()), raw));

  // Failure switches first (a switch never needs a valid token).
  const sw = takeSwitch(port, url.pathname, ['401', '429', '503', '500', '400', '403', '404']);
  if (sw) {
    entry.injected = sw.kind;
    res.ctx.skip = true;
    record(entry);
    const status = Number(sw.kind);
    const code = { 401: 'Unauthorized', 429: 'QuotaExceeded', 503: 'ServiceUnavailable', 500: 'InternalFailure', 400: 'InvalidInput', 403: 'Unauthorized', 404: 'NotFound' }[sw.kind];
    return json(res, status, { errors: [{ code, message: `injected ${sw.kind}` }] });
  }
  if (!entry.hasAccessToken || token !== currentToken) {
    entry.rejected = 'stale-or-missing-token';
    res.ctx.skip = true;
    record(entry);
    return json(res, 401, { errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] });
  }
  record(entry);

  const q = url.searchParams;
  const p = url.pathname;
  const markets = MARKETS[region];

  // --- Sellers ---
  if (p === '/sellers/v1/marketplaceParticipations') {
    return json(res, 200, {
      payload: markets.map((m) => ({ marketplace: { id: m.id, countryCode: m.country, defaultCurrencyCode: m.currency }, participation: { isParticipating: true } })),
    });
  }

  // --- Orders ---
  if (p === '/orders/2026-01-01/orders' && req.method === 'GET') {
    const la = q.get('lastUpdatedAfter');
    if (la && Date.parse(la) > Date.now() - 2 * 60 * 1000 + 1000) {
      return json(res, 400, { errors: [{ code: 'InvalidInput', message: 'lastUpdatedAfter must be at least two minutes in the past' }] });
    }
    const list = filterOrders(region, q);
    const size = Number(q.get('maxResultsPerPage') ?? 100);
    const { slice, next } = pageOf(list, q, size);
    return json(res, 200, { orders: slice, ...(next ? { pagination: { nextToken: next } } : {}), ...(la ? { lastUpdatedBefore: iso(-2 * 60 * 1000) } : {}) });
  }
  let m = p.match(/^\/orders\/2026-01-01\/orders\/([^/]+)$/);
  if (m && req.method === 'GET') {
    const order = fx.orders[region].find((o) => o.orderId === decodeURIComponent(m[1]));
    if (!order) return json(res, 404, { errors: [{ code: 'NotFound', message: 'order not found' }] });
    return json(res, 200, { order });
  }
  m = p.match(/^\/orders\/v0\/orders\/([^/]+)\/shipmentConfirmation$/);
  if (m && req.method === 'POST') {
    res.writeHead(204);
    return res.end();
  }

  // --- Catalog ---
  if (p === '/catalog/2022-04-01/items') {
    const ids = (q.get('identifiers') ?? '').split(',').filter(Boolean);
    const mk = q.get('marketplaceIds');
    const items = ids
      .filter((ean) => !ean.endsWith('0000'))
      .map((ean, i) => ({
        asin: `B0CAT${String(i).padStart(5, '0')}`,
        summaries: [{ marketplaceId: mk, itemName: `Catalog item ${ean}`, brand: 'FakeBrand' }],
        images: [{ marketplaceId: mk, images: [{ variant: 'MAIN', link: 'https://m.media-amazon.com/images/I/cat.jpg', height: 500, width: 500 }] }],
        identifiers: [{ marketplaceId: mk, identifiers: [{ identifierType: 'EAN', identifier: ean }] }],
        productTypes: [{ marketplaceId: mk, productType: 'LUGGAGE' }],
      }));
    return json(res, 200, { numberOfResults: items.length, items });
  }

  // --- Product type definitions ---
  if (p === '/definitions/2020-09-01/productTypes') {
    return json(res, 200, { productTypes: [{ name: 'LUGGAGE', displayName: 'Luggage', marketplaceIds: [q.get('marketplaceIds')] }, { name: 'SHOES', displayName: 'Shoes', marketplaceIds: [q.get('marketplaceIds')] }] });
  }
  m = p.match(/^\/definitions\/2020-09-01\/productTypes\/([^/]+)$/);
  if (m) {
    return json(res, 200, { productType: m[1], requirements: 'LISTING', schema: { link: { resource: `http://${req.headers.host}/docs/schema/${m[1]}`, verb: 'GET' }, checksum: 'x' } });
  }
  if (p.startsWith('/docs/schema/')) {
    const schema = {
      properties: {
        item_name: { title: 'Item name', description: 'Title', type: 'array', items: { type: 'object', properties: { value: { type: 'string', maxLength: 200 } }, required: ['value'] } },
        brand: { title: 'Brand', type: 'array', items: { type: 'object', properties: { value: { type: 'string', maxLength: 50 } }, required: ['value'] } },
      },
      required: ['item_name', 'brand'],
    };
    return json(res, 200, schema);
  }

  // --- Listings ---
  m = p.match(/^\/listings\/2021-08-01\/items\/([^/]+)(?:\/([^/]+))?$/);
  if (m) {
    const mk = (q.get('marketplaceIds') ?? markets[0].id).split(',')[0];
    const market = markets.find((x) => x.id === mk) ?? markets[0];
    const store = fx.listings[region];
    if (!m[2] && req.method === 'GET') {
      const ids = (q.get('identifiers') ?? '').split(',').filter(Boolean);
      let items = Object.entries(store).filter(([k]) => k.startsWith(`${market.id}:`)).map(([, v]) => v).sort((a, b) => a.sku.localeCompare(b.sku));
      if (ids.length) items = items.filter((i) => ids.includes(i.sku));
      const size = Number(q.get('pageSize') ?? 20);
      const { slice, next } = pageOf(items, q, size);
      return json(res, 200, { numberOfResults: items.length, items: slice, ...(next ? { pagination: { nextToken: next } } : {}) });
    }
    const sku = decodeURIComponent(m[2] ?? '');
    const key = `${market.id}:${sku}`;
    if (req.method === 'GET') {
      if (!store[key]) return json(res, 404, { errors: [{ code: 'NOT_FOUND', message: 'listing not found' }] });
      return json(res, 200, store[key]);
    }
    if (takeSwitch(port, p, ['invalid'])) {
      return json(res, 200, { sku, status: 'INVALID', submissionId: `sub-${++fx.seq}`, issues: [{ code: '90220', message: 'fake: attribute value is invalid', severity: 'ERROR' }] });
    }
    const body = raw ? JSON.parse(raw) : {};
    if (req.method === 'PUT') {
      store[key] = makeListing(market, sku, 'B0NEWASIN01');
    }
    if (req.method === 'PATCH' && store[key]) {
      for (const op of body.patches ?? []) {
        if (String(op.path).includes('fulfillment_availability')) {
          const qty = op.value?.[0]?.quantity;
          if (qty !== undefined) store[key].fulfillmentAvailability = [{ fulfillmentChannelCode: 'DEFAULT', quantity: qty }];
        }
        if (String(op.path).includes('purchasable_offer')) {
          const amount = op.value?.[0]?.our_price?.[0]?.schedule?.[0]?.value_with_tax;
          if (amount !== undefined) store[key].offers = [{ marketplaceId: market.id, offerType: 'B2C', price: money(String(amount), market.currency) }];
        }
      }
    }
    if (req.method === 'DELETE') delete store[key];
    return json(res, 200, { sku, status: 'ACCEPTED', submissionId: `sub-${++fx.seq}`, issues: [] });
  }

  // --- FBA inventory ---
  if (p === '/fba/inventory/v1/summaries') {
    const skus = (q.get('sellerSkus') ?? '').split(',').filter(Boolean);
    const summaries = skus.filter((s) => fx.fbaStock[region][s]).map((s) => ({ sellerSku: s, asin: 'B0FAKE0000F', fnSku: 'X00FAKE', inventoryDetails: fx.fbaStock[region][s], totalQuantity: 15, lastUpdatedTime: iso(-3600 * 1000) }));
    return json(res, 200, { payload: { inventorySummaries: summaries } });
  }

  // --- Feeds ---
  if (p === '/feeds/2021-06-30/documents' && req.method === 'POST') {
    const id = `fdoc-${++fx.seq}`;
    fx.docs[id] = { kind: 'feed-input', content: null };
    return json(res, 200, { feedDocumentId: id, url: `http://${req.headers.host}/docs/in/${id}` });
  }
  if (p === '/feeds/2021-06-30/feeds' && req.method === 'POST') {
    const body = JSON.parse(raw);
    const feedId = `feed-${++fx.seq}`;
    const resultId = `fres-${fx.seq}`;
    fx.feeds[feedId] = { feedId, feedType: body.feedType, inputFeedDocumentId: body.inputFeedDocumentId, processingStatus: 'DONE', resultFeedDocumentId: resultId, processingEndTime: iso(0) };
    fx.docs[resultId] = { kind: 'feed-result', content: 'Feed Processing Summary:\n\tNumber of records processed\t\t1\n\tNumber of records successful\t\t1\n' };
    return json(res, 202, { feedId });
  }
  m = p.match(/^\/feeds\/2021-06-30\/feeds\/([^/]+)$/);
  if (m) {
    const feed = fx.feeds[m[1]];
    return feed ? json(res, 200, feed) : json(res, 404, { errors: [{ code: 'NotFound', message: 'feed' }] });
  }
  m = p.match(/^\/feeds\/2021-06-30\/documents\/([^/]+)$/);
  if (m) {
    return json(res, 200, { feedDocumentId: m[1], url: `http://${req.headers.host}/docs/out/${m[1]}` });
  }

  // --- Reports ---
  if (p === '/reports/2021-06-30/reports' && req.method === 'POST') {
    const id = `rep-${++fx.seq}`;
    fx.reports[id] = { reportId: id, processingStatus: 'DONE', reportDocumentId: `rdoc-${fx.seq}`, processingEndTime: iso(0) };
    fx.docs[`rdoc-${fx.seq}`] = { kind: 'report', content: fx.returnsReport[region] };
    return json(res, 202, { reportId: id });
  }
  m = p.match(/^\/reports\/2021-06-30\/reports\/([^/]+)$/);
  if (m) {
    const r = fx.reports[m[1]];
    return r ? json(res, 200, r) : json(res, 404, { errors: [{ code: 'NotFound', message: 'report' }] });
  }
  m = p.match(/^\/reports\/2021-06-30\/documents\/([^/]+)$/);
  if (m) {
    return json(res, 200, { reportDocumentId: m[1], url: `http://${req.headers.host}/docs/out/${m[1]}` });
  }

  // --- Notifications ---
  if (p === '/notifications/v1/destinations') {
    if (req.method === 'POST') {
      const body = JSON.parse(raw);
      const d = { destinationId: `dest-${++fx.seq}`, name: body.name, resource: { sqs: { arn: body.resourceSpecification?.sqs?.arn } } };
      fx.destinations.push(d);
      return json(res, 200, { payload: d });
    }
    return json(res, 200, { payload: fx.destinations });
  }
  if (p === '/notifications/v1/subscriptions/ORDER_CHANGE') {
    if (req.method === 'POST') {
      const body = JSON.parse(raw);
      fx.subscription = { subscriptionId: `sub-${++fx.seq}`, destinationId: body.destinationId, payloadVersion: '1.0' };
      return json(res, 200, { payload: fx.subscription });
    }
    return fx.subscription ? json(res, 200, { payload: fx.subscription }) : json(res, 404, { errors: [{ code: 'NotFound', message: 'no subscription' }] });
  }

  // --- FBA outbound (MCF): present but empty; the executor points are live-only ---
  if (p.startsWith('/fba/outbound/')) {
    res.ctx.skip = true;
    return json(res, 404, { errors: [{ code: 'NotFound', message: 'fake: MCF is live-only' }] });
  }

  res.ctx.skip = true;
  return json(res, 404, { errors: [{ code: 'NotFound', message: `fake: no route ${req.method} ${p}` }] });
}

function handler(port) {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    try {
      const handled = await control(req, res, url, port);
      if (handled !== null) return;
      if (url.pathname.startsWith('/docs/')) {
        if (req.method === 'PUT') {
          const body = await readBody(req);
          const id = url.pathname.split('/').pop();
          if (fx.docs[id]) fx.docs[id].content = body;
          record({ port, host: req.headers.host, method: 'PUT', path: url.pathname, body: `[${body.length} bytes]` });
          res.writeHead(200);
          return res.end();
        }
        if (url.pathname.startsWith('/docs/out/')) {
          const doc = fx.docs[url.pathname.split('/').pop()];
          record({ port, host: req.headers.host, method: req.method, path: url.pathname });
          res.writeHead(doc ? 200 : 404, { 'content-type': 'text/plain; charset=UTF-8' });
          return res.end(doc?.content ?? '');
        }
        if (url.pathname.startsWith('/docs/schema/')) {
          record({ port, host: req.headers.host, method: req.method, path: url.pathname });
          return json(res, 200, {
            properties: {
              item_name: { title: 'Item name', description: 'Title', type: 'array', items: { type: 'object', properties: { value: { type: 'string', maxLength: 200 } }, required: ['value'] } },
              brand: { title: 'Brand', type: 'array', items: { type: 'object', properties: { value: { type: 'string', maxLength: 50 } }, required: ['value'] } },
            },
            required: ['item_name', 'brand'],
          });
        }
      }
      if (port === PORTS.lwa) return await lwa(req, res, url);
      return await spapi(req, res, url, port);
    } catch (error) {
      json(res, 500, { errors: [{ code: 'FakeServerError', message: String(error?.message ?? error) }] });
    }
  };
}

for (const port of Object.values(PORTS)) {
  http.createServer(handler(port)).listen(port, '0.0.0.0', () => console.log(`amazon fake listening on ${port}`));
}
