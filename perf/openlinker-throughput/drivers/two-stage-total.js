/**
 * k6 driver for the #2947 re-measurement - the paginated total as a second stage.
 *
 * #2843 measured `GET /orders` at a million rows: 149 ms, of which 142 ms was
 * the `COUNT(*)` under a `syncStatus @> ...` jsonb containment no plain index
 * serves. #2944 split that read in two. This driver measures the split.
 *
 * Every route is measured in ONE window against ONE dataset by ONE binary, and
 * the combined route is the control: it is the same `GET /orders` the operator
 * called before the change, still served unchanged by the same API. That makes
 * this an A/B within a single run rather than a comparison against a figure
 * recorded on a different day - which matters here, because the claim is a
 * ratio between two routes and not an absolute latency.
 *
 * One k6 Trend per named route, never a blended one (the #2842 precedent:
 * different routes measure different things and must not land in one bucket).
 * Percentiles are reported with their own within-run `n` by the report, which
 * reads this summary's per-Trend count rather than assuming a sample size.
 *
 * Env vars (read once, at init):
 *   API_BASE_URL     e.g. http://lab-api:3000/v1 (required)
 *   TOKEN            bearer token (required)
 *   DATASET_LABEL    e.g. "1M" - tagged onto every request (required)
 *   TARGET_RATE      requests/sec at plateau, default 20
 *   RAMP_UP_SECS     default 15
 *   PLATEAU_SECS     default 60
 *   RAMP_DOWN_SECS   default 10
 *   PRE_ALLOCATED_VUS default 20
 *   MAX_VUS          default 60
 *
 * @module perf/openlinker-throughput/drivers
 */
import http from 'k6/http';
import { Trend, Counter } from 'k6/metrics';

function readEnv(name, fallback) {
  const v = __ENV[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) {
      throw new Error(`two-stage-total.js: missing required env var ${name}`);
    }
    return fallback;
  }
  return v;
}

const API_BASE_URL = readEnv('API_BASE_URL');
const TOKEN = readEnv('TOKEN');
const DATASET_LABEL = readEnv('DATASET_LABEL');
const TARGET_RATE = Number(readEnv('TARGET_RATE', '20'));
const RAMP_UP_SECS = Number(readEnv('RAMP_UP_SECS', '15'));
const PLATEAU_SECS = Number(readEnv('PLATEAU_SECS', '60'));
const RAMP_DOWN_SECS = Number(readEnv('RAMP_DOWN_SECS', '10'));
const PRE_ALLOCATED_VUS = Number(readEnv('PRE_ALLOCATED_VUS', '20'));
const MAX_VUS = Number(readEnv('MAX_VUS', '60'));

const AUTH_HEADERS = { headers: { Authorization: `Bearer ${TOKEN}` } };
const non2xx = new Counter('non_2xx_responses');

/**
 * Two filter shapes, because they cost very different amounts and the epic is
 * about the expensive one.
 *
 * The unfiltered list counts every row. `health=needs_attention` is the
 * non-sargable `syncStatus @>` containment #2843 measured - the predicate no
 * plain index serves, and the one the whole change exists for.
 */
const ROUTES = [
  // The CONTROL: rows and total in one call, exactly as before the change.
  { name: 'combined', weight: 10, path: '/orders?limit=20&offset=0' },
  {
    name: 'combined_needs_attention',
    weight: 10,
    path: '/orders?limit=20&offset=0&health=needs_attention',
  },
  // Stage one: the page alone.
  { name: 'rows', weight: 10, path: '/orders?limit=20&offset=0&withTotal=false' },
  {
    name: 'rows_needs_attention',
    weight: 10,
    path: '/orders?limit=20&offset=0&health=needs_attention&withTotal=false',
  },
  // Stage two: the total alone.
  { name: 'count', weight: 10, path: '/orders/count' },
  { name: 'count_needs_attention', weight: 10, path: '/orders/count?health=needs_attention' },
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

export const options = {
  // k6's default summaryTrendStats omits p99, which is the whole point of a
  // per-route Trend (the #2842 lesson).
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
  scenarios: {
    two_stage: {
      executor: 'ramping-arrival-rate',
      exec: 'measure',
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
  },
};

export function measure() {
  const route = pickRoute();
  const res = http.get(`${API_BASE_URL}${route.path}`, {
    ...AUTH_HEADERS,
    tags: { name: route.name, dataset: DATASET_LABEL },
  });
  // Status is checked BEFORE the sample is recorded (#2590 correction 1: a
  // fast error otherwise counts as a fast sample and flatters the result).
  if (res.status >= 200 && res.status < 300) {
    routeTrends[route.name].add(res.timings.duration);
  } else {
    non2xx.add(1, { name: route.name });
  }
}
