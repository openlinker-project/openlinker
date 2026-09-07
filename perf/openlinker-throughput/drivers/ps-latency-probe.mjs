/**
 * PrestaShop create-path latency probe (#2840).
 *
 * WHAT THIS EXISTS TO SETTLE
 *
 * F1 (`results-F1-2026-09-07.md`) measured PrestaShop answering every
 * create-path webservice call in 11-20 ms and concluded ~99.5% of the
 * destination hop is OpenLinker-side. That measurement was taken at roughly
 * ONE REQUEST PER SECOND - three samples per endpoint on a system doing one
 * order at a time.
 *
 * The limiter A/B (`results-limiter-ab-2026-09-07.md`) then found that with a
 * dedicated Redis client and `requestsPerMinute: 600`, OpenLinker sustains
 * ~385 requests/min to the same shop - TEN TIMES the shipped 60/min. Nobody
 * has checked whether the shop still answers in 11-20 ms at that rate, and the
 * 60/min figure it would justify raising is NOT a documented PrestaShop quota:
 * `libs/integrations/prestashop/src/prestashop-plugin.ts:80-84` says in its own
 * words "Placeholder values pending the reporter's actual abuse-notice text".
 *
 * So this probe answers "does the shop survive 10x", and it is the difference
 * between reporting "2279 orders/h" and reporting "2279 orders/h that a real
 * shop tolerates".
 *
 * ---------------------------------------------------------------------------
 * A FAST ERROR IS NOT A FAST SAMPLE
 * ---------------------------------------------------------------------------
 * The campaign has already paid for this one. `results-lane-caps-2026-09-07.md`
 * correction 1 records a probe that never checked HTTP status, so a shop
 * shedding load with an instant 500 measured as excellent latency and the
 * conclusion inverted. Every sample here carries its status, every endpoint
 * declares the status it EXPECTS, and `ok` means "the expected status" and not
 * "the request returned". Aggregates are computed over `ok` samples and the
 * non-ok count is reported beside them, never folded in and never dropped
 * silently.
 *
 * ---------------------------------------------------------------------------
 * THE PROBE'S OWN REQUESTS ARE COUNTABLE, BECAUSE THEY CONTAMINATE
 * ---------------------------------------------------------------------------
 * `ps_requests_in_window` (scenarios/limiter-ab.sh) counts `/api/` lines in
 * PrestaShop's access log to derive requests-per-order. This probe's requests
 * land in that same log and would inflate it. They therefore carry a fixed,
 * unique User-Agent so the orchestrator can count them EXACTLY and subtract a
 * measured number rather than an estimated one. Do not change the default
 * without changing the subtraction.
 *
 * ---------------------------------------------------------------------------
 * GET-ONLY, AND THAT IS A STATED LIMIT RATHER THAN AN OVERSIGHT
 * ---------------------------------------------------------------------------
 * The create path's three POSTs (`customers`, `addresses`, `carts`) and its two
 * `POST /index.php` module calls have side effects - they mint real rows. A
 * probe that replayed them would be seeding the stand it is measuring. So the
 * mix is the create path's GET half, weighted by F1's own measured per-order
 * counts, and the report says so: a GET-only mix UNDER-represents a write-heavy
 * create path, so a flat latency curve here is necessary but not sufficient
 * evidence that a shop tolerates the rate.
 *
 * The URL shapes are not invented. Each is copied from what OpenLinker
 * actually sent, read out of PrestaShop's own access log.
 *
 * ---------------------------------------------------------------------------
 * ARRIVAL SCHEDULE, NOT SLEEP-BETWEEN-REQUESTS
 * ---------------------------------------------------------------------------
 * Requests are fired against a fixed arrival schedule (`start + n/rate`), not
 * by sleeping after each response. Under a sleep loop a shop that slows down
 * silently reduces the offered rate, so latency and rate move together and the
 * curve measures nothing. Here the offered rate is held and the ACHIEVED rate
 * is reported next to it: if they diverge, the probe could not keep up and says
 * so instead of quietly re-labelling the x-axis.
 *
 * Env vars (read once, at init):
 *   PS_BASE_URL      e.g. http://prestashop (required)
 *   PS_WS_KEY        PrestaShop webservice key, used as basic-auth user (required)
 *   DURATION_SECS    how long to sample, default 60
 *   TARGET_RPS       offered requests/sec, default 1
 *   PROBE_PRODUCT_ID product id for the by-id and stock_availables shapes, default 24
 *   MAX_INFLIGHT     safety cap on concurrent requests, default 64
 *   USER_AGENT       default olperf-latency-probe
 *   LABEL            free-text tag echoed on every row, default ""
 *
 * Emits CSV on stdout, one row per sample, plus a `#` comment summary block on
 * stderr so stdout stays machine-readable.
 *
 * ---------------------------------------------------------------------------
 * IT USES BARE `fetch` ON PURPOSE, AND THAT IS THE POINT RATHER THAN A BYPASS
 * ---------------------------------------------------------------------------
 * `scripts/check-outbound-http.mjs` and the matching ESLint rule forbid a bare
 * `fetch()` in a plugin, so a connection's `config.rateLimit` cannot be
 * silently evaded. Both scope themselves to `libs/integrations/*`, so this
 * file is outside them - and it must be. This is an INSTRUMENT measuring the
 * shop, not OpenLinker traffic: routing it through the paced transport would
 * make the probe's own samples arrive one rate-limit interval apart, so it
 * could never sample faster than the limiter admits and could not measure the
 * shop above that rate at all - which is the entire question. It holds no
 * OpenLinker connection and consumes no connection's budget.
 */

function readEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) {
      throw new Error(`ps-latency-probe: missing required env var ${name}`);
    }
    return fallback;
  }
  return v;
}

const PS_BASE_URL = readEnv('PS_BASE_URL').replace(/\/+$/, '');
const PS_WS_KEY = readEnv('PS_WS_KEY');
const DURATION_SECS = Number(readEnv('DURATION_SECS', '60'));
const TARGET_RPS = Number(readEnv('TARGET_RPS', '1'));
const PROBE_PRODUCT_ID = readEnv('PROBE_PRODUCT_ID', '24');
const MAX_INFLIGHT = Number(readEnv('MAX_INFLIGHT', '64'));
const USER_AGENT = readEnv('USER_AGENT', 'olperf-latency-probe');
const LABEL = readEnv('LABEL', '');

/**
 * The create path's GET half. `weight` is F1's own measured per-order count
 * for that resource (results-F1-2026-09-07.md, "Per-order destination request
 * breakdown"), so the mix this probe offers has the same SHAPE as the real
 * create path rather than an even split across endpoints.
 *
 * `expect` is the status that means the shop answered correctly.
 * `configurations` expects 401 on purpose: OpenLinker's own call is
 * unauthorised for that resource and answers 401 on every order, which is a
 * real ~7% of the rate-limit budget spent on a call that can never succeed.
 * Probing it measures what that wasted call costs the shop; treating its 401
 * as a failure would discard the sample and hide it.
 */
const ENDPOINTS = [
  { name: 'products_by_id', weight: 1.41, expect: 200, path: `/api/products/${PROBE_PRODUCT_ID}` },
  { name: 'order_states', weight: 1.35, expect: 200, path: '/api/order_states?display=full&id_shop=1&sort=[id_ASC]&limit=100' },
  { name: 'currencies', weight: 1.18, expect: 200, path: '/api/currencies?display=full&id_shop=1&filter[iso_code]=[PLN]&limit=1' },
  { name: 'countries', weight: 1.18, expect: 200, path: '/api/countries?display=full&id_shop=1&filter[iso_code]=[PL]&limit=10' },
  { name: 'carriers', weight: 1.0, expect: 200, path: '/api/carriers?display=full&id_shop=1&filter[external_module_name]=[openlinker]&limit=100' },
  { name: 'orders_by_reference', weight: 1.0, expect: 200, path: '/api/orders?display=full&id_shop=1&filter[reference]=[olperf-latency-probe-no-such-ref]&limit=1' },
  { name: 'stock_availables', weight: 0.94, expect: 200, path: `/api/stock_availables?display=full&id_shop=1&sort=[id_ASC]&filter[id_product]=[${PROBE_PRODUCT_ID}]&limit=100` },
  { name: 'configurations', weight: 0.94, expect: 401, path: '/api/configurations?display=full&id_shop=1&filter[name]=[PS_CURRENCY_DEFAULT]&limit=1' },
];

/**
 * A DETERMINISTIC weighted schedule, not random sampling. Two runs of this
 * probe at the same rate offer the identical endpoint sequence, so a latency
 * difference between them is the shop's and not the draw's - which matters
 * because the endpoints differ in cost by more than the effect being measured
 * (`order_states?limit=100` returns every state; `currencies?limit=1` returns
 * one row).
 */
function buildSchedule() {
  const scale = 100;
  const slots = [];
  for (const ep of ENDPOINTS) {
    const n = Math.max(1, Math.round(ep.weight * scale));
    for (let i = 0; i < n; i += 1) slots.push(ep);
  }
  // Interleave so any short sub-window still sees the whole mix rather than a
  // run of one endpoint - a 10 s slice of a 300 s window must be comparable.
  const out = [];
  const byName = new Map();
  for (const s of slots) {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
  }
  const lists = [...byName.values()];
  let remaining = slots.length;
  while (remaining > 0) {
    for (const l of lists) {
      const item = l.pop();
      if (item) {
        out.push(item);
        remaining -= 1;
      }
    }
  }
  return out;
}

const SCHEDULE = buildSchedule();
const AUTH = 'Basic ' + Buffer.from(`${PS_WS_KEY}:`).toString('base64');

const rows = [];
let inflight = 0;
let skippedForInflight = 0;

async function fire(ep, seq) {
  inflight += 1;
  const t0 = Date.now();
  const p0 = performance.now();
  let status = 0;
  let bytes = 0;
  let err = '';
  try {
    const res = await fetch(`${PS_BASE_URL}${ep.path}`, {
      headers: { Authorization: AUTH, 'User-Agent': USER_AGENT, Accept: 'application/xml' },
    });
    status = res.status;
    // The body must be drained or the connection is not returned to the pool
    // and the probe measures its own socket exhaustion instead of the shop.
    const body = await res.arrayBuffer();
    bytes = body.byteLength;
  } catch (e) {
    err = String(e && e.message ? e.message : e).slice(0, 80).replace(/[,\n]/g, ' ');
  } finally {
    inflight -= 1;
  }
  const latency = performance.now() - p0;
  rows.push({
    t: t0,
    seq,
    label: LABEL,
    name: ep.name,
    status,
    expect: ep.expect,
    ok: status === ep.expect ? 1 : 0,
    latency,
    bytes,
    err,
  });
}

/**
 * Returns a STRING, and `n/a` rather than `NaN`, when there is nothing to
 * report. At the top of a rate ramp it is entirely possible for every sample
 * to come back with an unexpected status, and a summary line reading
 * `p50 NaN` is the kind of thing a reader rounds off to "probably fine". `n/a`
 * beside an `ok 0 / 240` count says what actually happened.
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 'n/a';
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx].toFixed(1);
}

async function main() {
  const startedAt = Date.now();
  const intervalMs = 1000 / TARGET_RPS;
  const total = Math.max(1, Math.round(DURATION_SECS * TARGET_RPS));
  const pending = [];

  for (let n = 0; n < total; n += 1) {
    const due = startedAt + n * intervalMs;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (inflight >= MAX_INFLIGHT) {
      // Reported, never silently absorbed: hitting this cap means the offered
      // rate was not actually offered, which changes the x-axis of the curve.
      skippedForInflight += 1;
      continue;
    }
    pending.push(fire(SCHEDULE[n % SCHEDULE.length], n));
  }
  await Promise.all(pending);

  const stoppedAt = Date.now();
  const elapsedS = (stoppedAt - startedAt) / 1000;

  process.stdout.write('t_ms,seq,label,endpoint,status,expected,ok,latency_ms,bytes,err\n');
  for (const r of rows) {
    process.stdout.write(
      `${r.t},${r.seq},${r.label},${r.name},${r.status},${r.expect},${r.ok},${r.latency.toFixed(3)},${r.bytes},${r.err}\n`,
    );
  }

  const okRows = rows.filter((r) => r.ok === 1);
  const lat = okRows.map((r) => r.latency).sort((a, b) => a - b);
  const mean = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : NaN;
  const statusMix = {};
  for (const r of rows) statusMix[r.status] = (statusMix[r.status] || 0) + 1;

  const e = process.stderr;
  e.write(`# label            : ${LABEL}\n`);
  e.write(`# offered rps      : ${TARGET_RPS}\n`);
  e.write(`# achieved rps     : ${(rows.length / elapsedS).toFixed(2)} (${rows.length} samples / ${elapsedS.toFixed(1)} s)\n`);
  e.write(`# skipped (inflight cap ${MAX_INFLIGHT}): ${skippedForInflight}\n`);
  e.write(`# window           : ${startedAt} .. ${stoppedAt}\n`);
  e.write(`# samples ok       : ${okRows.length} / ${rows.length}\n`);
  e.write(`# status mix       : ${JSON.stringify(statusMix)}\n`);
  e.write(`# latency ok (ms)  : min ${lat.length ? lat[0].toFixed(1) : 'n/a'} p50 ${percentile(lat, 50)} p90 ${percentile(lat, 90)} p99 ${percentile(lat, 99)} max ${lat.length ? lat[lat.length - 1].toFixed(1) : 'n/a'} mean ${Number.isNaN(mean) ? 'n/a' : mean.toFixed(1)}\n`);
  for (const ep of ENDPOINTS) {
    const sub = okRows.filter((r) => r.name === ep.name).map((r) => r.latency).sort((a, b) => a - b);
    const all = rows.filter((r) => r.name === ep.name);
    e.write(
      `#   ${ep.name.padEnd(20)} n=${String(sub.length).padStart(4)}/${String(all.length).padStart(4)} p50 ${percentile(sub, 50).padStart(7)} p90 ${percentile(sub, 90).padStart(7)} max ${(sub.length ? sub[sub.length - 1].toFixed(1) : 'n/a').padStart(8)}\n`,
    );
  }
}

main().catch((e) => {
  process.stderr.write(`ps-latency-probe: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
