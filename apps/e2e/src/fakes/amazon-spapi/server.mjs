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

const PORTS = { lwa: 4100, eu: 4101, na: 4102, fe: 4103, sqs: 4104 };
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

function makeListing(market, sku, asin, fba = false, qty = 7, ean = '5901234123457') {
  return {
    sku,
    summaries: [
      { marketplaceId: market.id, asin, productType: 'LUGGAGE', status: ['BUYABLE'], itemName: `Listing ${sku}`, createdDate: iso(-30 * DAY), lastUpdatedDate: iso(-DAY), mainImage: { link: 'https://m.media-amazon.com/images/I/fake.jpg', height: 500, width: 500 } },
    ],
    attributes: {
      item_name: [{ value: `Listing ${sku}`, marketplace_id: market.id }],
      ...(ean ? { externally_assigned_product_identifier: [{ type: 'ean', value: ean, marketplace_id: market.id }] } : {}),
    },
    offers: [{ marketplaceId: market.id, offerType: 'B2C', price: money('39.90', market.currency) }],
    fulfillmentAvailability: [{ fulfillmentChannelCode: fba ? 'AMAZON_EU' : 'DEFAULT', quantity: qty }],
    issues: [],
  };
}

const RETURN_HEADER = 'Order ID\tOrder date\tReturn request date\tReturn request status\tAmazon RMA ID\tASIN\tMerchant SKU\tItem Name\tReturn quantity\tReturn reason\tOrder Amount\tOrder quantity';

function buildReturnsReport(region) {
  const rows = (fx.returns[region] ?? []).map((r) => [r.orderId, r.orderDate, r.requestDate, r.status, r.rma, r.asin, r.sku, r.name, r.quantity, r.reason, r.amount, r.orderQuantity].join('\t'));
  const seeded = (fx.returnsReport[region] ?? '').split('\n').slice(1);
  return [RETURN_HEADER, ...seeded, ...rows].join('\n');
}

function freshFixtures() {
  const fx = { orders: {}, listings: {}, fbaStock: {}, returnsReport: {}, returns: {}, feeds: {}, reports: {}, docs: {}, destinations: [], subscription: null, seq: 0, mcf: {}, sqs: [], inflight: {}, modes: { feed: 'normal', report: 'normal', mcfFulfillable: true } };
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
      fx.listings[region][`${m.id}:E2E-${m.country}-DEL`] = makeListing(m, `E2E-${m.country}-DEL`, 'B0FAKE0000D');
      fx.listings[region][`${m.id}:E2E-${m.country}-NEW`] = makeListing(m, `E2E-${m.country}-NEW`, 'B0FAKE0000N', false, 3, '5900000000000');
      fx.listings[region][`${m.id}:E2E-${m.country}-NOEAN`] = makeListing(m, `E2E-${m.country}-NOEAN`, 'B0FAKE0000E', false, 3, null);
      const fbaSku = `E2E-${m.country}-FBA`;
      fx.listings[region][`${m.id}:${fbaSku}`] = makeListing(m, fbaSku, 'B0FAKE0000F', true, 0);
      fx.fbaStock[region][fbaSku] = { fulfillableQuantity: 12, reservedQuantity: { totalReservedQuantity: 3 } };
    });
    const m0 = markets[0];
    fx.returns[region] = [];
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
let validTokens = new Set();

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
  res.writeHead(status, { 'content-type': 'application/json', 'x-amzn-requestid': `fake-${++fx.seq}`, ...(res.ctx ? { 'x-amzn-RateLimit-Limit': '5.0' } : {}), ...headers });
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
  if (url.pathname === '/__mode' && req.method === 'POST') {
    Object.assign(fx.modes, JSON.parse((await readBody(req)) || '{}'));
    return json(res, 200, fx.modes);
  }
  if (url.pathname === '/__buyer/purchase' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)) || '{}');
    const region = b.region ?? 'eu';
    const market = MARKETS[region].find((m) => m.id === b.marketplaceId) ?? MARKETS[region][0];
    const n = ++fx.seq;
    const base = makeOrder(region, market, b.noRecipient ? 'norole' : b.taxId ? 'taxid' : b.fba ? 'fba' : b.cod ? 'cod' : 'plain', 50 + n);
    const when = new Date(Date.now() - (b.ageMinutes ?? 2.5) * 60 * 1000).toISOString();
    const qty = b.qty ?? 1;
    const price = String(b.price ?? '39.90');
    const total = (Number(price) * qty + 5).toFixed(2);
    const order = {
      ...base,
      orderId: b.orderId ?? `${base.orderId.split('-')[0]}-BUY${String(n).padStart(4, '0')}-${market.country}`,
      createdTime: when,
      lastUpdatedTime: when,
      proceeds: { grandTotal: money(total, market.currency), breakdowns: [{ type: 'ITEM', subtotal: money((Number(price) * qty).toFixed(2), market.currency) }, { type: 'SHIPPING', subtotal: money('5.00', market.currency) }] },
      orderItems: [{ orderItemId: `${n}00000000000`, quantityOrdered: qty, product: { asin: b.asin ?? 'B0FAKE00001', title: b.title ?? `Bought ${b.sku}`, sellerSku: b.sku, price: { unitPrice: money(price, market.currency) } } }],
      fulfillment: { ...base.fulfillment, fulfillmentStatus: b.status ?? 'UNSHIPPED', ...(b.fba ? { fulfilledBy: 'AMAZON' } : {}) },
    };
    if (b.taxId) order.tax = { taxRegistrations: [{ taxRegistrationNumber: b.taxId, legalName: 'Buyer Co' }] };
    delete order.packages;
    fx.orders[region].push(order);
    return json(res, 200, { orderId: order.orderId });
  }
  if (url.pathname === '/__buyer/advance' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)) || '{}');
    const status = { Pending: 'PENDING', Unshipped: 'UNSHIPPED', Shipped: 'SHIPPED', Delivered: 'SHIPPED', Canceled: 'CANCELLED', Cancelled: 'CANCELLED' }[b.status] ?? b.status;
    for (const list of Object.values(fx.orders)) {
      const o = list.find((x) => x.orderId === b.orderId);
      if (!o) continue;
      o.fulfillment = { ...o.fulfillment, fulfillmentStatus: status };
      if (b.status === 'Delivered') o.packages = [...(o.packages ?? []), { packageReferenceId: '1', packageStatus: { status: 'DELIVERED' }, carrier: 'DPD', trackingNumber: 'DLV123' }];
      o.lastUpdatedTime = new Date(Date.now() - 2.5 * 60 * 1000).toISOString();
      return json(res, 200, { orderId: o.orderId, status });
    }
    return json(res, 404, { error: 'order not found' });
  }
  if (url.pathname === '/__buyer/return' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)) || '{}');
    const region = b.region ?? 'eu';
    const order = fx.orders[region].find((x) => x.orderId === b.orderId);
    if (!order) return json(res, 404, { error: 'order not found' });
    const item = order.orderItems.find((i) => i.product.sellerSku === b.sku) ?? order.orderItems[0];
    const n = ++fx.seq;
    fx.returns[region].push({ orderId: order.orderId, orderDate: order.createdTime.slice(0, 10), requestDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(), status: b.status ?? 'Approved', rma: b.rma ?? `RMA-${region}-${n}`, asin: item.product.asin, sku: item.product.sellerSku, name: item.product.title, quantity: b.quantity ?? 1, reason: b.reason ?? 'DEFECTIVE', amount: item.product.price.unitPrice.amount, orderQuantity: item.quantityOrdered });
    return json(res, 200, { rma: fx.returns[region].at(-1).rma });
  }
  if (url.pathname === '/__buyer/return-status' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)) || '{}');
    for (const list of Object.values(fx.returns)) for (const r of list) if (r.rma === b.rma) r.status = b.status;
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/__sqs/publish' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)) || '{}');
    const id = `m-${++fx.seq}`;
    const body = b.raw ?? JSON.stringify({ NotificationVersion: '1.0', NotificationType: b.type ?? 'ORDER_CHANGE', PayloadVersion: '1.0', EventTime: new Date().toISOString(), Payload: { OrderChangeNotification: { AmazonOrderId: b.orderId, OrderChangeType: b.changeType ?? 'OrderStatusChange' } }, NotificationMetadata: { ApplicationId: 'app', SubscriptionId: 's', PublishTime: new Date().toISOString(), NotificationId: b.notificationId ?? `n-${fx.seq}` } });
    fx.sqs.push({ MessageId: id, ReceiptHandle: `rh-${id}`, Body: body, visibleAt: 0 });
    return json(res, 200, { messageId: id, queued: fx.sqs.length });
  }
  if (url.pathname === '/__sim') {
    return json(res, 200, { confirmations: fx.confirmations ?? [], refundFeeds: fx.refundFeeds ?? [], mcf: Object.keys(fx.mcf).map((k) => ({ id: k, status: fx.mcf[k].status, speed: fx.mcf[k].request.shippingSpeedCategory })), sqs: fx.sqs.map((m) => m.MessageId), modes: fx.modes, destinations: fx.destinations, subscription: fx.subscription });
  }
  if (url.pathname === '/__violations') {
    return json(res, 200, { enabled: contracts !== null, violations });
  }
  if (url.pathname === '/__reset' && req.method === 'POST') {
    // Reports, feeds, documents and MCF orders survive a reset: OpenLinker keeps their ids in cursors.
    const keep = { reports: fx.reports, feeds: fx.feeds, docs: fx.docs, mcf: fx.mcf, seq: fx.seq, sqs: [] };
    fx = Object.assign(freshFixtures(), keep);
    violations = [];
    calls = [];
    switches = [];
    currentToken = null;
    validTokens = new Set();
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/__fail' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (body.kind === 'expire-tokens') validTokens = new Set();
    else if (body.clear) switches = [];
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
      if (body.patchOrder) {
        for (const list of Object.values(fx.orders)) {
          const o = list.find((x) => x.orderId === body.patchOrder.orderId);
          if (o) Object.assign(o, body.patchOrder, { lastUpdatedTime: new Date(Date.now() - 2.5 * 60 * 1000).toISOString() });
        }
      }
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
  validTokens.add(currentToken);
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
  if (contracts) {
    const invalid = validateRequest(contracts, req.method, url.pathname, Object.fromEntries(url.searchParams.entries()), raw);
    violation(port, req.method, url.pathname, 'request', invalid);
    if (invalid.length > 0 && !invalid[0].startsWith('no operation')) {
      // Like Amazon: an invalid request is refused, it is not answered as if it were valid.
      res.ctx.skip = true;
      record({ ...entry, rejected: 'contract-violation' });
      return json(res, 400, { errors: [{ code: 'InvalidInput', message: invalid.join('; ').slice(0, 300) }] });
    }
  }

  // Failure switches first (a switch never needs a valid token).
  const sw = takeSwitch(port, url.pathname, ['401', '429', '503', '500', '400', '403', '404']);
  if (sw) {
    entry.injected = sw.kind;
    res.ctx.skip = true;
    record(entry);
    const status = Number(sw.kind);
    const code = { 401: 'Unauthorized', 429: 'QuotaExceeded', 503: 'ServiceUnavailable', 500: 'InternalFailure', 400: 'InvalidInput', 403: 'Unauthorized', 404: 'NotFound' }[sw.kind];
    return json(res, status, { errors: [{ code, message: `injected ${sw.kind}`, details: '' }] });
  }
  if (!entry.hasAccessToken || !validTokens.has(token)) {
    entry.rejected = 'stale-or-missing-token';
    res.ctx.skip = true;
    record(entry);
    // Real SP-API answers a bad access token with 403 Unauthorized (LWA itself answers 401).
    return json(res, 403, { errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.', details: 'The access token you provided is revoked, malformed or invalid.' }] });
  }
  record(entry);

  const q = url.searchParams;
  const p = url.pathname;
  const markets = MARKETS[region];
  const asked = (q.get('marketplaceIds') ?? '').split(',').filter(Boolean);
  if (asked.some((id) => !markets.some((m) => m.id === id))) {
    res.ctx.skip = true;
    return json(res, 403, { errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.', details: 'The marketplaces you provided are not valid for region.' }] });
  }

  // --- Sellers ---
  if (p === '/sellers/v1/marketplaceParticipations') {
    return json(res, 200, {
      payload: markets.filter((m) => m.id !== fx.modes.hideMarketplace).map((m) => ({ marketplace: { id: m.id, countryCode: m.country, name: m.name, defaultCurrencyCode: m.currency, defaultLanguageCode: 'en_US', domainName: m.name.replace('Amazon.', 'www.amazon.') }, storeName: `E2E store ${m.country}`, participation: { isParticipating: true, hasSuspendedListings: false } })),
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
    if (!q.get('includedData')) {
      res.ctx.skip = true;
      return json(res, 400, { errors: [{ code: 'InvalidInput', message: 'Could not match input arguments', details: '' }] });
    }
    const order = fx.orders[region].find((o) => o.orderId === decodeURIComponent(m[1]));
    if (!order) return json(res, 404, { errors: [{ code: 'NotFound', message: 'order not found' }] });
    return json(res, 200, { order });
  }
  m = p.match(/^\/orders\/v0\/orders\/([^/]+)\/shipmentConfirmation$/);
  if (m && req.method === 'POST') {
    const order = fx.orders[region].find((o) => o.orderId === decodeURIComponent(m[1]));
    if (!order) return json(res, 404, { errors: [{ code: 'NotFound', message: 'order not found' }] });
    if (['SHIPPED', 'CANCELLED'].includes(order.fulfillment?.fulfillmentStatus)) {
      // Amazon refuses a second confirmation for an order that is already complete.
      res.ctx.skip = true;
      return json(res, 400, { errors: [{ code: 'InvalidInput', message: `Order ${order.orderId} is already ${order.fulfillment.fulfillmentStatus}` }] });
    }
    const body = JSON.parse(raw);
    const pkg = body.packageDetail ?? {};
    const itemIds = (pkg.orderItems ?? []).map((i) => i.orderItemId);
    const all = order.orderItems.every((i) => itemIds.includes(i.orderItemId));
    order.fulfillment = { ...order.fulfillment, fulfillmentStatus: all ? 'SHIPPED' : 'PARTIALLY_SHIPPED' };
    order.packages = [...(order.packages ?? []), { packageReferenceId: String(pkg.packageReferenceId ?? fx.seq), packageStatus: { status: 'SHIPPED' }, carrier: pkg.carrierCode ?? pkg.carrierName, trackingNumber: pkg.trackingNumber, shipTime: pkg.shipDate }];
    order.lastUpdatedTime = new Date().toISOString();
    fx.confirmations = [...(fx.confirmations ?? []), { orderId: order.orderId, carrier: pkg.carrierCode, tracking: pkg.trackingNumber, items: itemIds }];
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
    return json(res, 200, { productTypeVersion: 'LATEST', productTypes: [{ name: 'LUGGAGE', displayName: 'Luggage', marketplaceIds: [q.get('marketplaceIds')] }, { name: 'SHOES', displayName: 'Shoes', marketplaceIds: [q.get('marketplaceIds')] }] });
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

  // --- FBA inventory: seeding endpoints of the real sandbox (idempotency token required) ---
  if (p === '/fba/inventory/v1/items' && req.method === 'POST') {
    const b = JSON.parse(raw);
    if (!b.marketplaceId) { res.ctx.skip = true; return json(res, 400, { errors: [{ code: 'InvalidInput', message: 'MarketplaceId is required for Operation: CreateInventoryItem', details: '' }] }); }
    fx.fbaStock[region][b.sellerSku] = fx.fbaStock[region][b.sellerSku] ?? { fulfillableQuantity: 0, reservedQuantity: { totalReservedQuantity: 0 } };
    return json(res, 200, {});
  }
  if (p === '/fba/inventory/v1/items/inventory' && req.method === 'POST') {
    const tokenHeader = req.headers['x-amzn-idempotency-token'];
    fx.idem = fx.idem ?? new Set();
    if (!tokenHeader || fx.idem.has(tokenHeader)) {
      res.ctx.skip = true;
      return json(res, 400, { errors: [{ code: 'InvalidInput', message: !tokenHeader ? 'Idempotency Token is required for Operation: AddInventory' : 'Idempotency token already used', details: '' }] });
    }
    fx.idem.add(tokenHeader);
    const b = JSON.parse(raw);
    for (const item of b.inventoryItems ?? []) {
      const cur = fx.fbaStock[region][item.sellerSku] ?? { fulfillableQuantity: 0, reservedQuantity: { totalReservedQuantity: 0 } };
      cur.fulfillableQuantity += item.quantity ?? 0;
      fx.fbaStock[region][item.sellerSku] = cur;
    }
    return json(res, 200, {});
  }

  // --- FBA inventory ---
  if (p === '/fba/inventory/v1/summaries') {
    const skus = (q.get('sellerSkus') ?? '').split(',').filter(Boolean);
    const summaries = skus.filter((s) => fx.fbaStock[region][s]).map((s) => ({ sellerSku: s, asin: 'B0FAKE0000F', fnSku: 'X00FAKE', inventoryDetails: fx.fbaStock[region][s], totalQuantity: 15, lastUpdatedTime: iso(-3600 * 1000) }));
    return json(res, 200, { payload: { granularity: { granularityType: 'Marketplace', granularityId: q.get('granularityId') ?? markets[0].id }, inventorySummaries: summaries } });
  }

  // --- Feeds ---
  if (p === '/feeds/2021-06-30/documents' && req.method === 'POST') {
    const id = `fdoc-${++fx.seq}`;
    fx.docs[id] = { kind: 'feed-input', content: null };
    return json(res, 201, { feedDocumentId: id, url: `http://${req.headers.host}/docs/in/${id}` });
  }
  if (p === '/feeds/2021-06-30/feeds' && req.method === 'POST') {
    const body = JSON.parse(raw);
    const feedId = `feed-${++fx.seq}`;
    const input = fx.docs[body.inputFeedDocumentId]?.content ?? '';
    fx.feeds[feedId] = { feedId, feedType: body.feedType, inputFeedDocumentId: body.inputFeedDocumentId, processingStatus: 'IN_QUEUE', polls: 0, mode: fx.modes.feed, input, region };
    return json(res, 202, { feedId });
  }
  m = p.match(/^\/feeds\/2021-06-30\/feeds\/([^/]+)$/);
  if (m) {
    const feed = fx.feeds[m[1]];
    if (!feed) return json(res, 404, { errors: [{ code: 'NotFound', message: 'feed' }] });
    feed.polls += 1;
    // IN_QUEUE -> IN_PROGRESS -> terminal, one stage per poll (mode: normal | rejected | fatal | slow).
    if (feed.mode === 'slow') feed.processingStatus = feed.polls > 6 ? 'DONE' : 'IN_PROGRESS';
    else if (feed.polls === 1) feed.processingStatus = 'IN_QUEUE';
    else if (feed.polls === 2) feed.processingStatus = 'IN_PROGRESS';
    else feed.processingStatus = feed.mode === 'fatal' ? 'FATAL' : 'DONE';
    if (['DONE', 'FATAL'].includes(feed.processingStatus) && !feed.resultFeedDocumentId && feed.mode !== 'fatal') {
      const resultId = `fres-${++fx.seq}`;
      feed.resultFeedDocumentId = resultId;
      feed.processingEndTime = iso(0);
      fx.docs[resultId] = {
        kind: 'feed-result',
        content:
          feed.mode === 'rejected'
            ? 'Feed Processing Summary:\n\tNumber of records processed\t\t1\n\tNumber of records successful\t\t0\n\noriginal-record-number\tsku\terror-code\terror-type\terror-message\n1\t\t8560\tError\tThe refund amount exceeds the order total\n'
            : 'Feed Processing Summary:\n\tNumber of records processed\t\t1\n\tNumber of records successful\t\t1\n',
      };
      fx.refundFeeds = [...(fx.refundFeeds ?? []), { feedId: feed.feedId, type: feed.feedType, mode: feed.mode, input: feed.input }];
    }
    if (feed.processingStatus === 'FATAL') feed.processingEndTime = iso(0);
    const { polls, mode, input, region: r2, ...wire } = feed;
    void polls; void mode; void input; void r2;
    return json(res, 200, wire);
  }
  m = p.match(/^\/feeds\/2021-06-30\/documents\/([^/]+)$/);
  if (m) {
    return json(res, 200, { feedDocumentId: m[1], url: `http://${req.headers.host}/docs/out/${m[1]}` });
  }

  // --- Reports ---
  if (p === '/reports/2021-06-30/reports' && req.method === 'POST') {
    const id = `rep-${++fx.seq}`;
    fx.reports[id] = { reportId: id, reportType: JSON.parse(raw).reportType, processingStatus: 'IN_QUEUE', createdTime: iso(0), marketplaceIds: JSON.parse(raw).marketplaceIds, polls: 0, mode: fx.modes.report, region };
    return json(res, 202, { reportId: id });
  }
  m = p.match(/^\/reports\/2021-06-30\/reports\/([^/]+)$/);
  if (m) {
    const r = fx.reports[m[1]];
    if (!r) return json(res, 404, { errors: [{ code: 'NotFound', message: 'report' }] });
    r.polls += 1;
    r.processingStatus = r.polls === 1 ? 'IN_QUEUE' : r.polls === 2 ? 'IN_PROGRESS' : r.mode === 'fatal' ? 'FATAL' : r.mode === 'cancelled' ? 'CANCELLED' : 'DONE';
    if (r.processingStatus === 'DONE' && !r.reportDocumentId) {
      r.reportDocumentId = `rdoc-${++fx.seq}`;
      r.processingEndTime = iso(0);
      fx.docs[r.reportDocumentId] = { kind: 'report', content: buildReturnsReport(r.region) };
    }
    const { polls, mode, region: r3, ...wire } = r;
    void polls; void mode; void r3;
    return json(res, 200, wire);
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

  // --- FBA outbound (MCF): a stateful fulfillment order ---
  if (p === '/fba/outbound/2020-07-01/fulfillmentOrders/preview' && req.method === 'POST') {
    const body = JSON.parse(raw);
    const ok = fx.modes.mcfFulfillable && (body.items ?? []).every((i) => fx.fbaStock[region][i.sellerSku]);
    return json(res, 200, { payload: { fulfillmentPreviews: (body.shippingSpeedCategories ?? ['Standard']).map((c) => ({ shippingSpeedCategory: c, isFulfillable: ok, isCODCapable: false, marketplaceId: body.marketplaceId, fulfillmentPreviewShipments: [], unfulfillablePreviewItems: ok ? [] : (body.items ?? []).map((i) => ({ sellerSku: i.sellerSku, sellerFulfillmentOrderItemId: i.sellerFulfillmentOrderItemId, quantity: i.quantity, itemUnfulfillableReasons: ['NoStock'] })) })) } });
  }
  if (p === '/fba/outbound/2020-07-01/fulfillmentOrders' && req.method === 'POST') {
    const body = JSON.parse(raw);
    const id = body.sellerFulfillmentOrderId;
    if (fx.mcf[id]) {
      res.ctx.skip = true;
      return json(res, 400, { errors: [{ code: 'InvalidInput', message: 'Order Already Exists', details: '' }] });
    }
    fx.mcf[id] = { request: body, status: 'Received', polls: 0, receivedDate: iso(0), items: body.items, region };
    res.writeHead(200, { 'content-type': 'application/json', 'x-amzn-requestid': `fake-${++fx.seq}` });
    return res.end('{}');
  }
  m = p.match(/^\/fba\/outbound\/2020-07-01\/fulfillmentOrders\/([^/]+)(\/cancel)?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const o = fx.mcf[id];
    if (!o) { res.ctx.skip = true; return json(res, 400, { errors: [{ code: 'InvalidInput', message: 'Order Does Not Exist', details: '' }] }); }
    if (m[2] && req.method === 'PUT') {
      if (['Processing', 'Complete', 'CompletePartialled'].includes(o.status)) {
        res.ctx.skip = true;
        return json(res, 400, { errors: [{ code: 'InvalidRequestException', message: 'The fulfillment order can no longer be cancelled' }] });
      }
      o.status = 'Cancelled';
      return json(res, 200, {});
    }
    o.polls += 1;
    if (!['Cancelled', 'Complete'].includes(o.status) && o.mode !== 'hold') {
      o.status = o.polls === 1 ? 'Received' : o.polls === 2 ? 'Planning' : o.polls === 3 ? 'Processing' : 'Complete';
    }
    const shipped = o.status === 'Complete';
    return json(res, 200, {
      payload: {
        fulfillmentOrder: { sellerFulfillmentOrderId: id, marketplaceId: o.request.marketplaceId, displayableOrderId: o.request.displayableOrderId, displayableOrderDate: o.request.displayableOrderDate, displayableOrderComment: o.request.displayableOrderComment, shippingSpeedCategory: o.request.shippingSpeedCategory, destinationAddress: o.request.destinationAddress, receivedDate: o.receivedDate, fulfillmentOrderStatus: o.status, statusUpdatedDate: iso(0) },
        fulfillmentOrderItems: o.items.map((i) => ({ sellerSku: i.sellerSku, sellerFulfillmentOrderItemId: i.sellerFulfillmentOrderItemId, quantity: i.quantity, cancelledQuantity: o.status === 'Cancelled' ? i.quantity : 0, unfulfillableQuantity: 0 })),
        fulfillmentShipments: shipped ? [{ amazonShipmentId: `AMZ-${id}`, fulfillmentCenterId: 'FC1', fulfillmentShipmentStatus: 'SHIPPED', shippingDate: iso(0), fulfillmentShipmentItem: o.items.map((i) => ({ sellerSku: i.sellerSku, sellerFulfillmentOrderItemId: i.sellerFulfillmentOrderItemId, quantity: i.quantity })), fulfillmentShipmentPackage: [{ packageNumber: 1, carrierCode: 'DPD', trackingNumber: `MCF${id.slice(-8)}` }] }] : [],
        returnItems: [], returnAuthorizations: [],
      },
    });
  }
  if (p.startsWith('/fba/outbound/')) {
    res.ctx.skip = true;
    return json(res, 404, { errors: [{ code: 'NotFound', message: 'fake: no such MCF route' }] });
  }

  res.ctx.skip = true;
  return json(res, 404, { errors: [{ code: 'NotFound', message: `fake: no route ${req.method} ${p}` }] });
}

async function sqsHandler(req, res) {
  const raw = await readBody(req);
  const target = req.headers['x-amz-target'] ?? '';
  const body = raw ? JSON.parse(raw) : {};
  record({ port: PORTS.sqs, host: req.headers.host, method: req.method, path: target, hasSigV4: String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256'), authScope: String(req.headers.authorization ?? '').match(/Credential=[^/]+\/\d+\/([^/]+)\/sqs/)?.[1] ?? null, queueUrl: body.QueueUrl, body: raw.slice(0, 300) });
  if (takeSwitch(PORTS.sqs, target, ['sqs-fail'])) {
    res.writeHead(400, { 'content-type': 'application/x-amz-json-1.0' });
    return res.end(JSON.stringify({ __type: 'com.amazon.coral.service#AccessDeniedException', message: 'not authorized' }));
  }
  res.writeHead(200, { 'content-type': 'application/x-amz-json-1.0', 'x-amzn-requestid': `sqs-${++fx.seq}` });
  if (target === 'AmazonSQS.ReceiveMessage') {
    const now = Date.now();
    const out = fx.sqs.filter((m) => m.visibleAt <= now).slice(0, body.MaxNumberOfMessages ?? 1);
    for (const m of out) m.visibleAt = now + 30_000;
    return res.end(JSON.stringify(out.length ? { Messages: out.map(({ MessageId, ReceiptHandle, Body }) => ({ MessageId, ReceiptHandle, Body, MD5OfBody: 'x' })) } : {}));
  }
  if (target === 'AmazonSQS.DeleteMessageBatch') {
    const handles = new Set((body.Entries ?? []).map((e) => e.ReceiptHandle));
    fx.sqs = fx.sqs.filter((m) => !handles.has(m.ReceiptHandle));
    return res.end(JSON.stringify({ Successful: (body.Entries ?? []).map((e) => ({ Id: e.Id })), Failed: [] }));
  }
  return res.end('{}');
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
      if (port === PORTS.sqs) return await sqsHandler(req, res);
      return await spapi(req, res, url, port);
    } catch (error) {
      json(res, 500, { errors: [{ code: 'FakeServerError', message: String(error?.message ?? error) }] });
    }
  };
}

for (const port of Object.values(PORTS)) {
  http.createServer(handler(port)).listen(port, '0.0.0.0', () => console.log(`amazon fake listening on ${port}`));
}
