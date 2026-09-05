/**
 * k6 driver for the webhook-ingress burst scenario (#2842, epic #2840).
 *
 * Replays PRE-SIGNED bytes from a pool built by `presign-webhooks.mjs` -
 * this file computes NO HMAC (plan § 3.1: k6 must never contend with the api
 * for CPU signing HMACs during the measurement window, since the stand pins
 * no CPUs).
 *
 * `ramping-arrival-rate`, never `ramping-vus` (plan § 4.4): an arrival-rate
 * executor holds the REQUEST RATE constant regardless of how slow the system
 * under test answers, which is the only executor shape that measures what
 * the api can absorb rather than what k6's own concurrency happened to be.
 *
 * Run inside the `grafana/k6:1.0.0` container - never on the host - because
 * the api/worker containers sit on a Docker bridge network the container can
 * join and the host process cannot reach by container name.
 *
 * Env vars (all read once, at init - see `readEnv` below):
 *   POOL_FILE        path to the pool.json this VU should load (required)
 *   TARGET_URL       full URL to POST to, e.g. http://ol-demo-fresh-api:3000/webhooks/prestashop/<id> (required)
 *   RUN_START_MS     wall-clock ms this run's window opens at - MUST equal the
 *                     --window-start-ms the pool was built with (required)
 *   ARM              unique | replay-committed | replay-concurrent - used only
 *                     to name this arm's own Trend metric (plan § 3.3: "never
 *                     averaged", so each arm gets its own bucket) (required)
 *   GEN_INTERVAL_MS   default 60000 - MUST equal the pre-signer's
 *                     --gen-interval-secs * 1000
 *   TARGET_RATE       requests/sec at plateau, default 50
 *   RAMP_UP_SECS      default 10
 *   PLATEAU_SECS      default 30
 *   RAMP_DOWN_SECS    default 5
 *   PRE_ALLOCATED_VUS default 20
 *   MAX_VUS           default 100
 */
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import exec from 'k6/execution';

function readEnv(name, fallback) {
  const v = __ENV[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) {
      throw new Error(`webhook-burst.js: missing required env var ${name}`);
    }
    return fallback;
  }
  return v;
}

const POOL_FILE = readEnv('POOL_FILE');
const TARGET_URL = readEnv('TARGET_URL');
const RUN_START_MS = Number(readEnv('RUN_START_MS'));
const ARM = readEnv('ARM');
const GEN_INTERVAL_MS = Number(readEnv('GEN_INTERVAL_MS', '60000'));
const TARGET_RATE = Number(readEnv('TARGET_RATE', '50'));
const RAMP_UP_SECS = Number(readEnv('RAMP_UP_SECS', '10'));
const PLATEAU_SECS = Number(readEnv('PLATEAU_SECS', '30'));
const RAMP_DOWN_SECS = Number(readEnv('RAMP_DOWN_SECS', '5'));
const PRE_ALLOCATED_VUS = Number(readEnv('PRE_ALLOCATED_VUS', '20'));
const MAX_VUS = Number(readEnv('MAX_VUS', '100'));

// `open()` only works in the init context (top-level module scope) - loaded
// once per VU. A `SharedArray` would dedupe this across VUs, but the pool
// object here is `{ meta, generations: [...] }`, not a flat array, and
// SharedArray requires a flat-array-returning function; keeping the plain
// per-VU parse is a stated, honest limitation (see the scenario README
// section this driver is documented under) rather than a silent one - on the
// PRE_ALLOCATED_VUS/MAX_VUS scale this scenario runs at, the duplication cost
// is bytes-of-JSON times tens of VUs, not a real constraint.
const pool = JSON.parse(open(POOL_FILE));

if (!pool.generations || pool.generations.length === 0) {
  throw new Error(`webhook-burst.js: pool at ${POOL_FILE} carries no generations`);
}

// One Trend per ARM (plan § 3.3 - "never averaged": `unique`, `replay-committed`
// and `replay-concurrent` measure different things - one lock-free, one fully
// serialized - and must never land in the same bucket). Only a 2xx response's
// duration is recorded here; every non-2xx goes to `non2xx` instead and is
// excluded from the reported percentiles (plan § 4.4).
const gateDuration = new Trend(`webhook_${ARM}_duration_ms`, true);
const non2xx = new Counter('non_2xx_responses');

export const options = {
  scenarios: {
    [ARM]: {
      executor: 'ramping-arrival-rate',
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

/**
 * Pick the generation whose timestamp is legal for THIS moment in the run
 * (plan § 3.2). Elapsed time is measured against RUN_START_MS - the same
 * instant the pre-signer used to build generation 0's timestamp - so a
 * request fired at elapsed=90s picks generation 1 (timestamp = start + 60s),
 * which is within the ±120s default skew window of "now" for the whole time
 * generation 1 is in use.
 */
function pickGeneration() {
  const elapsedMs = Date.now() - RUN_START_MS;
  let g = Math.floor(elapsedMs / GEN_INTERVAL_MS);
  if (g < 0) g = 0;
  if (g >= pool.generations.length) g = pool.generations.length - 1;
  return pool.generations[g];
}

export default function () {
  const gen = pickGeneration();
  // `iterationInTest` is a monotonically increasing counter across every VU
  // for this scenario (k6/execution) - a global sequential index with no
  // shared mutable state to race on, which is exactly what "replay bytes,
  // compute nothing" needs. Modulo into the CURRENT generation's own entry
  // list - not the whole pool - so an entry is never replayed from a
  // generation whose timestamp is not the one legal for this moment.
  const idx = exec.scenario.iterationInTest % gen.entries.length;
  const entry = gen.entries[idx];

  const res = http.post(TARGET_URL, entry.body, {
    headers: {
      'Content-Type': 'application/json',
      'X-OpenLinker-Timestamp': String(gen.timestampMs),
      'X-OpenLinker-Signature': entry.signature,
    },
    tags: { arm: ARM },
  });

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  if (ok) {
    gateDuration.add(res.timings.duration);
  } else {
    non2xx.add(1);
  }
}
