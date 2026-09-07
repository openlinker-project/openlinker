/**
 * Self-test for the PrestaShop fault-injection proxy (#2978).
 *
 * Runs entirely in-process against a throwaway upstream on an ephemeral port
 * - it never touches the `lab` stand, so it can be run while a peer holds
 * `guard_stand_exclusive`. That is the point: the fault injection this
 * scenario depends on has to be provably correct BEFORE it is pointed at a
 * measured window, or a window spent on a proxy bug is a window wasted.
 *
 *   node test.mjs
 *
 * Exits non-zero on the first failure and prints the assertion count, so a
 * silently-empty run cannot pass (the #2673 shape - "not covered" and
 * "covered and passing" must not read the same).
 */

import http from 'node:http';
import { server, state, bucketOf, ruleMatches } from './server.mjs';

let checks = 0;
let failures = 0;

function check(cond, label) {
  checks += 1;
  if (cond) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  FAIL ${label}\n`);
  }
}

function eq(actual, expected, label) {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

// --- a throwaway upstream ---------------------------------------------------
const upstreamHits = [];
const upstream = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  upstreamHits.push({
    method: req.method,
    url: req.url,
    host: req.headers.host,
    auth: req.headers.authorization || null,
    body: Buffer.concat(chunks).toString('utf8'),
  });
  res.writeHead(200, { 'Content-Type': 'application/json', 'X-Upstream': 'yes' });
  res.end(JSON.stringify({ upstream: true, url: req.url }));
});

function listen(s, port = 0) {
  return new Promise((resolve) => s.listen(port, '127.0.0.1', () => resolve(s.address().port)));
}

function request(port, method, path, { body, timeoutMs = 5000, headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, timedOut: true, headers: {}, body: '' });
    });
    req.on('error', (err) => resolve({ status: null, error: err.code || String(err.message), headers: {}, body: '' }));
    if (body) req.write(body);
    req.end();
  });
}

async function ctl(port, method, path, body) {
  const r = await request(port, method, path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });
  return { status: r.status, json: r.body ? JSON.parse(r.body) : null };
}

async function main() {
  const upstreamPort = await listen(upstream);
  // The proxy reads CONFIG at import time, so the throwaway upstream's
  // ephemeral port is injected by mutating the module's own exported CONFIG -
  // the same in-process pattern the Allegro stub's test.mjs uses.
  const { CONFIG } = await import('./server.mjs');
  CONFIG.upstreamHost = '127.0.0.1';
  CONFIG.upstreamPort = upstreamPort;
  CONFIG.upstreamHostHeader = 'prestashop';
  const proxyPort = await listen(server);

  process.stdout.write('bucketOf\n');
  eq(bucketOf('/api/carts?ws_key=X'), 'api:carts', 'webservice path buckets by resource');
  eq(bucketOf('/api/orders/12'), 'api:orders', 'webservice path with an id buckets by resource');
  // The two literal paths from prestashop-openlinker-module.client.ts's own
  // IMPORTORDER_PATH / CARTSHIPPING_PATH constants, not a paraphrase of them.
  eq(
    bucketOf('/index.php?fc=module&module=openlinker&controller=importorder'),
    'module:importorder',
    'the real importorder front-controller path buckets as module:importorder',
  );
  eq(
    bucketOf('/index.php?fc=module&module=openlinker&controller=cartshipping'),
    'module:cartshipping',
    'the real cartshipping front-controller path buckets as module:cartshipping',
  );
  eq(
    bucketOf('/index.php?fc=module&module=openlinker'),
    'module:unknown',
    'a module path with no controller is named, not dropped',
  );
  eq(bucketOf('/robots.txt'), 'other', 'anything else buckets as other');

  process.stdout.write('ruleMatches\n');
  const req = { method: 'POST' };
  eq(ruleMatches(null, req, '/api/carts'), false, 'no rule never matches');
  eq(
    ruleMatches({ mode: '500', fraction: 1, methods: ['GET'], pathIncludes: null }, req, '/api/carts'),
    false,
    'method filter excludes',
  );
  eq(
    ruleMatches({ mode: '500', fraction: 1, methods: ['POST'], pathIncludes: null }, req, '/api/carts'),
    true,
    'method filter includes',
  );
  eq(
    ruleMatches({ mode: '500', fraction: 1, methods: null, pathIncludes: 'importorder' }, req, '/api/carts'),
    false,
    'path filter excludes',
  );
  eq(
    ruleMatches({ mode: '500', fraction: 0, methods: null, pathIncludes: null }, req, '/api/carts'),
    false,
    'fraction 0 never matches',
  );
  // A non-matching path must not consume a draw. Asserted by construction:
  // with fraction 1 and a non-matching path the answer is false, which can
  // only happen if the path test ran first.
  eq(
    ruleMatches({ mode: '500', fraction: 1, methods: null, pathIncludes: 'nope' }, req, '/api/carts'),
    false,
    'path test precedes the coin flip',
  );

  process.stdout.write('transparent proxying\n');
  let r = await request(proxyPort, 'GET', '/api/carts?ws_key=SECRET', {
    headers: { Authorization: 'Basic abc' },
  });
  eq(r.status, 200, 'a request with no rule reaches the upstream');
  check(r.headers['x-upstream'] === 'yes', 'upstream response headers are preserved');
  eq(upstreamHits.at(-1).host, 'prestashop', 'the Host header is rewritten to the upstream host');
  eq(upstreamHits.at(-1).auth, 'Basic abc', 'the Authorization header is forwarded');
  eq(upstreamHits.at(-1).url, '/api/carts?ws_key=SECRET', 'the query string is forwarded verbatim');

  r = await request(proxyPort, 'POST', '/api/carts', { body: '<cart><id>1</id></cart>' });
  eq(r.status, 200, 'a POST reaches the upstream');
  eq(upstreamHits.at(-1).body, '<cart><id>1</id></cart>', 'the request body is forwarded byte for byte');

  process.stdout.write('the 500 fault\n');
  await ctl(proxyPort, 'POST', '/__fault', { mode: '500', fraction: 1, pathIncludes: 'controller=importorder' });
  const before = upstreamHits.length;
  r = await request(proxyPort, 'POST', '/index.php?fc=module&module=openlinker&controller=importorder');
  eq(r.status, 500, 'a matching request is answered 500');
  eq(upstreamHits.length, before, 'a faulted request never reaches the upstream');
  r = await request(proxyPort, 'POST', '/api/carts');
  eq(r.status, 200, 'a non-matching request still reaches the upstream');
  check(upstreamHits.length === before + 1, 'the non-matching request did reach the upstream');

  process.stdout.write('the 429 fault, both header variants\n');
  const installed = await ctl(proxyPort, 'POST', '/__fault', { mode: '429', fraction: 1 });
  // Reported === enforced: the rule the control surface (and therefore the
  // manifest) reports must carry the resolved value, not an absent one that
  // some later branch fills in.
  eq(installed.json.rule.retryAfterSeconds, 5, 'an omitted retryAfterSeconds is RESOLVED into the stored rule');
  r = await request(proxyPort, 'GET', '/api/orders');
  eq(r.status, 429, 'default 429 is answered');
  eq(r.headers['retry-after'], '5', 'a 429 with no explicit retryAfterSeconds carries the default header');
  await ctl(proxyPort, 'POST', '/__fault', { mode: '429', fraction: 1, retryAfterSeconds: 17 });
  r = await request(proxyPort, 'GET', '/api/orders');
  eq(r.headers['retry-after'], '17', 'an explicit retryAfterSeconds is honoured');
  await ctl(proxyPort, 'POST', '/__fault', { mode: '429', fraction: 1, retryAfterSeconds: null });
  r = await request(proxyPort, 'GET', '/api/orders');
  eq(r.status, 429, 'a 429 is still answered when the header is suppressed');
  eq(r.headers['retry-after'], undefined, 'an explicit null retryAfterSeconds sends NO Retry-After header');

  process.stdout.write('the hang fault\n');
  await ctl(proxyPort, 'POST', '/__fault', { mode: 'hang', fraction: 1, hangMs: 3000 });
  r = await request(proxyPort, 'GET', '/api/orders', { timeoutMs: 400 });
  eq(r.timedOut, true, 'a hang fault does not answer inside the client timeout');

  process.stdout.write('the reset fault\n');
  await ctl(proxyPort, 'POST', '/__fault', { mode: 'reset', fraction: 1 });
  r = await request(proxyPort, 'GET', '/api/orders', { timeoutMs: 2000 });
  eq(r.status, null, 'a reset fault produces no status');
  check(r.error === 'ECONNRESET' || r.error === 'ECONNABORTED', `a reset fault drops the connection (got ${r.error})`);

  process.stdout.write('counters\n');
  await ctl(proxyPort, 'POST', '/__fault/reset');
  await ctl(proxyPort, 'POST', '/__fault', { mode: '500', fraction: 1, pathIncludes: 'controller=importorder' });
  await request(proxyPort, 'POST', '/index.php?fc=module&module=openlinker&controller=importorder');
  await request(proxyPort, 'POST', '/index.php?fc=module&module=openlinker&controller=cartshipping');
  await request(proxyPort, 'GET', '/api/carts');
  let stats = (await ctl(proxyPort, 'GET', '/__fault/stats')).json;
  eq(stats.counters.total, 3, 'every proxied request is counted');
  eq(stats.counters.faulted, 1, 'only the matching request is counted as faulted');
  eq(stats.counters.proxied, 2, 'the other two reached the upstream');
  eq(stats.counters.byBucket['module:importorder'].faulted, 1, 'the fault is attributed to its own bucket');
  eq(
    stats.counters.byBucket['module:cartshipping'].proxied,
    1,
    'a sibling front controller in the same module is untouched',
  );
  eq(stats.counters.byBucket['api:carts'].proxied, 1, 'webservice traffic is untouched');
  // This is the partial-create shape #2978 asks for, asserted directly.
  check(
    stats.counters.byBucket['module:importorder'].faulted === 1 &&
      (stats.counters.byBucket['api:carts'].faulted ?? 0) === 0,
    'cart succeeds while importorder fails - the partial-create fault is expressible',
  );

  process.stdout.write('the control surface is never faulted\n');
  await ctl(proxyPort, 'POST', '/__fault', { mode: '500', fraction: 1 });
  const health = await ctl(proxyPort, 'GET', '/__fault/health');
  eq(health.status, 200, 'health answers 200 under a fraction-1 blanket 500 rule');
  const statsUnderFault = await ctl(proxyPort, 'GET', '/__fault/stats');
  eq(statsUnderFault.status, 200, 'stats answers 200 under a fraction-1 blanket 500 rule');

  process.stdout.write('rule validation\n');
  eq((await ctl(proxyPort, 'POST', '/__fault', { mode: 'nonsense' })).status, 400, 'an unknown mode is refused');
  eq((await ctl(proxyPort, 'POST', '/__fault', { mode: '500', fraction: 2 })).status, 400, 'fraction > 1 is refused');
  eq(
    (await ctl(proxyPort, 'POST', '/__fault', { mode: '500', methods: 'POST' })).status,
    400,
    'a non-array methods is refused',
  );
  eq((await ctl(proxyPort, 'DELETE', '/__fault')).json.rule, null, 'DELETE clears the rule');
  r = await request(proxyPort, 'GET', '/api/carts');
  eq(r.status, 200, 'traffic flows again once the rule is cleared');

  process.stdout.write('fraction is honoured statistically\n');
  await ctl(proxyPort, 'POST', '/__fault/reset');
  await ctl(proxyPort, 'POST', '/__fault', { mode: '500', fraction: 0.5 });
  for (let i = 0; i < 200; i += 1) await request(proxyPort, 'GET', '/api/carts');
  stats = (await ctl(proxyPort, 'GET', '/__fault/stats')).json;
  // A wide band on purpose: this asserts the coin flip is a coin flip, not
  // that 200 draws land near the mean. 0.5 +/- 0.15 fails on roughly one run
  // in 10^7 and catches "always" / "never" immediately.
  check(
    stats.counters.faulted > 70 && stats.counters.faulted < 130,
    `fraction 0.5 over 200 requests faulted ${stats.counters.faulted} (expected 70..130)`,
  );
  eq(stats.counters.total, 200, 'every request in the fraction run was counted');
  eq(
    stats.counters.faulted + stats.counters.proxied,
    200,
    'faulted + proxied accounts for every request - none is lost from the ledger',
  );

  server.close();
  upstream.close();
  process.stdout.write(`\n${checks} checks, ${failures} failure(s)\n`);
  if (checks < 49) {
    process.stdout.write('FAIL: fewer checks ran than this suite declares - a silently-empty run must not pass\n');
    process.exit(1);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(`FATAL ${err && err.stack}\n`);
  process.exit(1);
});
