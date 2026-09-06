/**
 * k6 driver for F5 - operator read path at row count (#2843, epic #2840).
 *
 * Replays a realistic operator BROWSE MIX (orders list + filtered list,
 * order detail, products list + detail, jobs dashboard) as one
 * `ramping-arrival-rate` scenario, plus a SEPARATE `page_shell` scenario
 * that fires the app shell's own nav-probe fan-out as one group per
 * "page load" - measured apart from the browse mix on purpose (#2843 AC
 * "the page-shell request tax is measured separately from the page's own
 * query").
 *
 * One k6 Trend per named route (never one blended Trend across routes -
 * the #2842 webhook-burst.js precedent: different routes measure different
 * things and must never land in the same bucket). Every route's request
 * count is whatever `ramping-arrival-rate` x its weight produces - NOT
 * fixed - so #2843's own AC ("every reported percentile carries its own
 * within-run n; a route whose n is too small says so") is enforced by the
 * REPORT reading the k6 summary JSON's per-Trend count, not by this driver.
 *
 * Env vars (all read once, at init):
 *   API_BASE_URL    e.g. http://lab-api:3000/v1 (required)
 *   TOKEN            bearer token, minted by the orchestrator's ol_login (required)
 *   IDS_FILE         path to {orderIds:[...], productIds:[...]} sampled by the
 *                    orchestrator from the live dataset (required)
 *   DATASET_LABEL    e.g. "10k" / "100k" / "1M" - tagged onto every request,
 *                    used only for the request tag/log line, never to branch
 *                    behaviour (required)
 *   TARGET_RATE      requests/sec at plateau for the browse mix, default 20
 *   RAMP_UP_SECS     default 15
 *   PLATEAU_SECS     default 60
 *   RAMP_DOWN_SECS   default 10
 *   PAGE_SHELL_RATE  page-loads/sec for the page-shell scenario, default 2
 *   PRE_ALLOCATED_VUS default 20
 *   MAX_VUS          default 60
 */
import http from 'k6/http';
import { Trend, Counter } from 'k6/metrics';

function readEnv(name, fallback) {
  const v = __ENV[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) {
      throw new Error(`read-path.js: missing required env var ${name}`);
    }
    return fallback;
  }
  return v;
}

const API_BASE_URL = readEnv('API_BASE_URL');
const TOKEN = readEnv('TOKEN');
const IDS_FILE = readEnv('IDS_FILE');
const DATASET_LABEL = readEnv('DATASET_LABEL');
const TARGET_RATE = Number(readEnv('TARGET_RATE', '20'));
const RAMP_UP_SECS = Number(readEnv('RAMP_UP_SECS', '15'));
const PLATEAU_SECS = Number(readEnv('PLATEAU_SECS', '60'));
const RAMP_DOWN_SECS = Number(readEnv('RAMP_DOWN_SECS', '10'));
const PAGE_SHELL_RATE = Number(readEnv('PAGE_SHELL_RATE', '2'));
const PRE_ALLOCATED_VUS = Number(readEnv('PRE_ALLOCATED_VUS', '20'));
const MAX_VUS = Number(readEnv('MAX_VUS', '60'));

// `open()` only works at init scope - per-VU parse, same accepted-limitation
// shape as webhook-burst.js's pool load (small JSON, tens of VUs, bytes not
// a real constraint).
const ids = JSON.parse(open(IDS_FILE));
if (!ids.orderIds || ids.orderIds.length === 0) {
  throw new Error(`read-path.js: ${IDS_FILE} carries no orderIds - did the orchestrator seed and sample before starting k6?`);
}
if (!ids.productIds || ids.productIds.length === 0) {
  throw new Error(`read-path.js: ${IDS_FILE} carries no productIds`);
}

const AUTH_HEADERS = { headers: { Authorization: `Bearer ${TOKEN}` } };

const non2xx = new Counter('non_2xx_responses');

// One Trend per named route. k6 Trend names may only contain
// letters/digits/underscores (the #2842 lesson - a hyphen aborts the whole
// scenario at construction time), so every name below is snake_case already.
const ROUTES = [
  { name: 'orders_list', weight: 25, path: () => '/orders?limit=20&offset=0' },
  { name: 'orders_list_needs_attention', weight: 10, path: () => '/orders?limit=20&offset=0&health=needs_attention' },
  {
    name: 'order_detail',
    weight: 20,
    path: () => `/orders/${ids.orderIds[Math.floor(Math.random() * ids.orderIds.length)]}`,
  },
  { name: 'products_list', weight: 20, path: () => '/products?limit=20&offset=0' },
  {
    name: 'product_detail',
    weight: 15,
    path: () => `/products/${ids.productIds[Math.floor(Math.random() * ids.productIds.length)]}`,
  },
  { name: 'sync_jobs_list', weight: 10, path: () => '/sync/jobs?limit=20&offset=0' },
];
const TOTAL_WEIGHT = ROUTES.reduce((sum, r) => sum + r.weight, 0);
const routeTrends = {};
for (const r of ROUTES) {
  routeTrends[r.name] = new Trend(`route_${r.name}_duration_ms`, true);
}

function pickRoute() {
  let x = Math.random() * TOTAL_WEIGHT;
  for (const r of ROUTES) {
    if (x < r.weight) return r;
    x -= r.weight;
  }
  return ROUTES[ROUTES.length - 1];
}

// Page-shell probes (#2843: "10 requests before content, not nine") -
// five limit:1 nav probes + one unpaginated connections read + the system
// config read. Mirrors apps/web/src/app/hooks/use-nav-counts.ts and
// app-shell.tsx's useSystemConfigQuery - see that file's own header comment
// for why each of these five is a `{limit:1}` probe.
const PAGE_SHELL_REQUESTS = [
  { name: 'shell_connections', path: '/connections' },
  { name: 'shell_orders_probe', path: '/orders?limit=1' },
  { name: 'shell_listings_probe', path: '/listings?limit=1' },
  { name: 'shell_jobs_dead_probe', path: '/sync/jobs?limit=1&status=dead' },
  { name: 'shell_webhooks_failed_probe', path: '/webhook-deliveries?limit=1&status=failed' },
];
const pageShellTotalTrend = new Trend('page_shell_total_duration_ms', true);
const pageShellRequestTrend = new Trend('page_shell_request_duration_ms', true);

export const options = {
  // k6 default summaryTrendStats omits p99 (the #2842 lesson, restated here
  // rather than only cited: the whole point of a per-route Trend is a
  // percentile the default silently drops from --summary-export).
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
  scenarios: {
    browse_mix: {
      executor: 'ramping-arrival-rate',
      exec: 'browseMix',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: PRE_ALLOCATED_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { target: TARGET_RATE, duration: `${RAMP_UP_SECS}s` },
        { target: TARGET_RATE, duration: `${PLATEAU_SECS}s` },
        { target: 0, duration: `${RAMP_DOWN_SECS}s` },
      ],
    },
    page_shell: {
      executor: 'ramping-arrival-rate',
      exec: 'pageShell',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: Math.max(5, Math.ceil(PAGE_SHELL_RATE * 2)),
      maxVUs: Math.max(10, Math.ceil(PAGE_SHELL_RATE * 4)),
      stages: [
        { target: PAGE_SHELL_RATE, duration: `${RAMP_UP_SECS}s` },
        { target: PAGE_SHELL_RATE, duration: `${PLATEAU_SECS}s` },
        { target: 0, duration: `${RAMP_DOWN_SECS}s` },
      ],
    },
  },
};

export function browseMix() {
  const route = pickRoute();
  const res = http.get(`${API_BASE_URL}${route.path()}`, {
    ...AUTH_HEADERS,
    tags: { name: route.name, dataset: DATASET_LABEL },
  });
  if (res.status >= 200 && res.status < 300) {
    routeTrends[route.name].add(res.timings.duration);
  } else {
    non2xx.add(1, { name: route.name });
  }
}

export function pageShell() {
  const start = Date.now();
  for (const r of PAGE_SHELL_REQUESTS) {
    const res = http.get(`${API_BASE_URL}${r.path}`, {
      ...AUTH_HEADERS,
      tags: { name: r.name, dataset: DATASET_LABEL },
    });
    if (res.status >= 200 && res.status < 300) {
      pageShellRequestTrend.add(res.timings.duration, { name: r.name });
    } else {
      non2xx.add(1, { name: r.name });
    }
  }
  pageShellTotalTrend.add(Date.now() - start);
}
