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
 *   EXECUTOR          ramping-arrival-rate (default) | constant-vus (#2930).
 *                     ramping-arrival-rate holds the REQUEST RATE constant -
 *                     the right shape for the `unique`/`replay-committed`
 *                     throughput-ceiling arms, where concurrency is whatever
 *                     it needs to be to sustain the rate. constant-vus holds
 *                     the VIRTUAL-USER COUNT constant instead - the right
 *                     shape for forcing a DELIBERATE collision on one
 *                     eventId at a rate the system is otherwise comfortable
 *                     with, rather than getting concurrency only as a
 *                     side effect of the system falling behind an arrival
 *                     rate (which arrives entangled with CPU/pool/WAL
 *                     saturation - see results-F3-2026-09-06.md's own
 *                     "replay-concurrent is a null result at 43/s" finding).
 *   TARGET_RATE       requests/sec at plateau, default 50 (ramping-arrival-rate only)
 *   RAMP_UP_SECS      default 10 (ramping-arrival-rate only)
 *   PLATEAU_SECS      default 30 (ramping-arrival-rate only)
 *   RAMP_DOWN_SECS    default 5 (ramping-arrival-rate only)
 *   PRE_ALLOCATED_VUS default 20 (ramping-arrival-rate only)
 *   MAX_VUS           default 100 (ramping-arrival-rate only)
 *   VUS               fixed virtual-user count, default 1 (constant-vus only)
 *   DURATION_SECS     how long the fixed VU pool runs, default
 *                     RAMP_UP_SECS+PLATEAU_SECS+RAMP_DOWN_SECS (constant-vus only)
 */
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';

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
const EXECUTOR = readEnv('EXECUTOR', 'ramping-arrival-rate');
const TARGET_RATE = Number(readEnv('TARGET_RATE', '50'));
const RAMP_UP_SECS = Number(readEnv('RAMP_UP_SECS', '10'));
const PLATEAU_SECS = Number(readEnv('PLATEAU_SECS', '30'));
const RAMP_DOWN_SECS = Number(readEnv('RAMP_DOWN_SECS', '5'));
const PRE_ALLOCATED_VUS = Number(readEnv('PRE_ALLOCATED_VUS', '20'));
const MAX_VUS = Number(readEnv('MAX_VUS', '100'));
const VUS = Number(readEnv('VUS', '1'));
const DURATION_SECS = Number(
  readEnv('DURATION_SECS', String(RAMP_UP_SECS + PLATEAU_SECS + RAMP_DOWN_SECS))
);

if (EXECUTOR !== 'ramping-arrival-rate' && EXECUTOR !== 'constant-vus') {
  throw new Error(`webhook-burst.js: EXECUTOR must be ramping-arrival-rate or constant-vus, got '${EXECUTOR}'`);
}

// Loaded ONCE, not once per VU (#2931). Two things had to change together to
// get there, both verified live against the pinned grafana/k6:1.0.0 image:
//
// 1. `SharedArray` - k6's own answer to "parse this once, share it read-only
//    across every VU". A plain `JSON.parse(open(POOL_FILE))` here (the
//    pre-#2931 shape) gave every VU its OWN parsed copy of the whole pool,
//    so memory grew as pool-bytes times VU count - confirmed as the cause of
//    two real OOM kills at the 1000/s tier (results-F3-2026-09-06.md).
//
// 2. A FLAT entries array. `SharedArray` genuinely shares a flat array of
//    plain objects, but the pre-#2931 pool shape was
//    `{ meta, generations: [ { timestampMs, entries: [...] } ] }` - an array
//    of objects each holding a NESTED array. Measured live: wrapping that
//    nested shape in a `SharedArray` did NOT hold memory flat as VU count
//    rose (5 VUs -> ~730 MB; 50 VUs -> ~5.2 GB; 150 VUs -> OOM-killed at a
//    3 GB cgroup limit) - each VU still ends up materializing its own copy
//    of every nested sub-array it indexes into. Flattening `entries` (one
//    array, no nesting - `timestampMs` denormalized onto EACH entry instead
//    of living once on a wrapping generation object) and sharing THAT
//    measured flat regardless of VU count (5 VUs and 150 VUs both landed
//    within a few percent of each other - see presign-webhooks.mjs's own
//    pre-flight-budget comment for the exact figures this drove).
//
// `generationIndex` stays a SEPARATE, small `SharedArray` rather than being
// folded into a per-entry field, because a VU still needs O(1) access to
// "which contiguous slice of `entries` belongs to generation g" on every
// single request - scanning 90 000 entries by `timestampMs` per HTTP call
// would spend k6's own CPU on work this driver exists specifically to avoid
// (see the file header: k6 must never contend with the api for CPU).
//
// Both `SharedArray` constructors read `POOL_FILE` independently rather than
// sharing one parse - each is a self-contained, one-time cost (not
// VU-scaled), which is simpler and safer than trying to smuggle a second
// value out of one SharedArray's constructor via a closure side effect.
const generationIndex = new SharedArray('webhook_burst_generation_index', function () {
  const pool = JSON.parse(open(POOL_FILE));
  if (!pool.generationIndex || pool.generationIndex.length === 0) {
    throw new Error(`webhook-burst.js: pool at ${POOL_FILE} carries no generationIndex`);
  }
  return pool.generationIndex;
});

const entries = new SharedArray('webhook_burst_entries', function () {
  const pool = JSON.parse(open(POOL_FILE));
  if (!pool.entries || pool.entries.length === 0) {
    throw new Error(`webhook-burst.js: pool at ${POOL_FILE} carries no entries`);
  }
  return pool.entries;
});

// One Trend per ARM (plan § 3.3 - "never averaged": `unique`, `replay-committed`
// and `replay-concurrent` measure different things - one lock-free, one fully
// serialized - and must never land in the same bucket). Only a 2xx response's
// duration is recorded here; every non-2xx goes to `non2xx` instead and is
// excluded from the reported percentiles (plan § 4.4).
//
// k6 Trend names may only contain letters/digits/underscores - `ARM` carries
// a hyphen for both replay arms ("replay-committed", "replay-concurrent"),
// which k6 rejects with a hard GoError script exception at Trend-construction
// time (found live, run 1 of #2842's rate sweep: the `unique` arm completed
// clean, then `replay-committed` aborted the whole scenario before sending a
// single request). The metric NAME is sanitized; ARM itself (used for the
// `tags: {arm: ARM}` request tag and every log line) is left exactly as the
// scenario passes it, so the report's arm labels stay human-readable.
const metricArm = ARM.replace(/-/g, '_');
const gateDuration = new Trend(`webhook_${metricArm}_duration_ms`, true);
const non2xx = new Counter('non_2xx_responses');

export const options = {
  // k6's default summaryTrendStats is ['avg','min','med','max','p(90)','p(95)']
  // - NO p99, on every Trend the run produces, including the built-in
  // `http_req_duration`. The whole point of this scenario is "the sustained
  // arrival rate before p99 breaches 1s" (plan §3.3/AC), so the un-overridden
  // default silently made the AC's own headline number unreachable from the
  // --summary-export JSON (found live, #2842's rate sweep: run
  // `run1788650401-unique`'s k6-summary.json carries p(90)/p(95) and no
  // p(99) at all). p(99) is added explicitly rather than replacing the
  // existing five, so a report built before this fix and one built after it
  // both still carry p50/p90/p95 in the same shape.
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    // #2930: constant-vus is a DELIBERATE collision instrument, not a
    // throughput probe - a fixed pool of VUS virtual users all replaying
    // the SAME pre-signed entry (the pool is built with --distinct-ids 1)
    // for DURATION_SECS, so index-tuple contention is forced at a rate the
    // system is otherwise comfortable with, rather than arriving only as a
    // side effect of a ramping-arrival-rate run falling behind its target.
    [ARM]:
      EXECUTOR === 'constant-vus'
        ? {
            executor: 'constant-vus',
            vus: VUS,
            duration: `${DURATION_SECS}s`,
          }
        : {
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
 * Pick the generation slice whose timestamp is legal for THIS moment in the
 * run (plan § 3.2). Elapsed time is measured against RUN_START_MS - the same
 * instant the pre-signer used to build generation 0's timestamp - so a
 * request fired at elapsed=90s picks generation 1 (timestamp = start + 60s),
 * which is within the ±120s default skew window of "now" for the whole time
 * generation 1 is in use. Returns `{ timestampMs, startIndex, count }` - a
 * slice into the flat `entries` SharedArray (#2931), not an object holding
 * its own copy of the entries.
 */
function pickGeneration() {
  const elapsedMs = Date.now() - RUN_START_MS;
  let g = Math.floor(elapsedMs / GEN_INTERVAL_MS);
  if (g < 0) g = 0;
  if (g >= generationIndex.length) g = generationIndex.length - 1;
  return generationIndex[g];
}

export default function () {
  const gen = pickGeneration();
  // `iterationInTest` is a monotonically increasing counter across every VU
  // for this scenario (k6/execution) - a global sequential index with no
  // shared mutable state to race on, which is exactly what "replay bytes,
  // compute nothing" needs. Modulo into the CURRENT generation's own slice
  // of `entries` - not the whole pool - so an entry is never replayed from a
  // generation whose timestamp is not the one legal for this moment.
  const idx = gen.startIndex + (exec.scenario.iterationInTest % gen.count);
  const entry = entries[idx];

  const res = http.post(TARGET_URL, entry.body, {
    headers: {
      'Content-Type': 'application/json',
      'X-OpenLinker-Timestamp': String(entry.timestampMs),
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
