#!/usr/bin/env node
// @ts-nocheck
/**
 * Pre-signer for the webhook-ingress burst scenario (#2842, epic #2840).
 *
 * The design constraint (implementation-plan-f3-webhook-burst.md § 3.1) is
 * that k6 must never compute an HMAC during the measurement window - the
 * stand pins no CPUs, so a k6 process signing thousands of requests would
 * contend with the api for the exact CPU the api needs to answer them, which
 * would silently move the number this scenario measures. So signing happens
 * here, on the host, ahead of time, and k6 only replays pre-built bytes.
 *
 * This script does NOT restate the OL-HMAC scheme. It imports the real
 * signer straight out of the e2e suite:
 *
 *   apps/e2e/src/support/webhooks.ts
 *
 * ...via `node --experimental-strip-types`, which works because that file
 * uses only erasable TypeScript syntax (interfaces, type-only constructs) and
 * imports nothing but `node:crypto` (verified live - see the plan's § 2.6).
 * If that file ever gains non-erasable syntax (an enum, a parameter
 * property, decorators), this import breaks LOUDLY at the `import` line
 * rather than silently drifting from the real scheme - which is the point of
 * importing it instead of copying it.
 *
 * Run with:
 *   node --experimental-strip-types perf/openlinker-throughput/drivers/presign-webhooks.mjs [flags]
 *
 * Output: a `pool.json` shaped
 *   { meta: {...},
 *     generationIndex: [ { timestampMs, startIndex, count }, ... ],
 *     entries: [ { timestampMs, eventId, body, signature }, ... ] }
 *
 * `entries` is FLAT - one array, no nesting - and `generationIndex` is a
 * small side table of slice boundaries into it (#2931). This replaces the
 * earlier `generations: [{ timestampMs, entries: [...] }]` shape, which grouped
 * entries by generation. That shape is what k6's `webhook-burst.js` used to
 * `JSON.parse` once PER VIRTUAL USER, and separately, deep nesting defeats
 * `SharedArray`'s sharing even when it IS used - see that driver's own header
 * comment for the measurements behind both changes.
 *
 * @module perf/openlinker-throughput/drivers
 */
import { signWebhook } from '../../../apps/e2e/src/support/webhooks.ts';
import { writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { freemem } from 'node:os';

// ---------------------------------------------------------------------------
// Arg parsing - flags only, no positional args, no external dep.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true; // boolean flag
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function die(msg) {
  process.stderr.write(`[presign-webhooks] FATAL ${msg}\n`);
  process.exit(1);
}

function requireArg(args, name) {
  const v = args[name];
  if (v === undefined || v === true) die(`missing required --${name}`);
  return v;
}

function help() {
  process.stdout.write(`Pre-sign a pool of OL-HMAC webhook requests (#2842).

Required:
  --connection-id <uuid>     the connection every request targets
  --secret <hex>             the connection's PLAINTEXT webhook secret
                              (POST /v1/connections/:id/webhooks/secret/rotate)
  --count <n>                total entries to generate across all generations
  --window-start-ms <epoch>  real wall-clock ms the k6 run will open its window at -
                              must match the RUN_START_MS the k6 driver is given
  --duration-secs <n>        planned run duration - used to size the pool's
                              generation coverage and to refuse a pool that
                              would run out of skew-window-legal timestamps
  --arm <unique|replay-committed|replay-concurrent>

Optional:
  --provider <name>              default: prestashop
  --out <path>                   default: ./pool.json
  --gen-interval-secs <n>         default: 60 (plan § 3.2)
  --skew-window-ms <n>            default: 120000 (OL_WEBHOOK_SKEW_WINDOW_MS default)
  --payload-bytes <n>             default: 256 - approximate padded payload size
  --event-type <str>              default: order.created
  --object-type <str>             default: order
  --external-id-prefix <str>      default: perf-burst
  --reuse-ids-file <path>         required for --arm replay-committed - a JSON
                                   file of the shape {"eventIds": [...]} or a
                                   plain newline list of ids, e.g. one written
                                   alongside a prior --arm unique pool
  --distinct-ids <n>              for --arm replay-concurrent - how many
                                   DISTINCT eventIds the whole pool cycles
                                   through (default: 5) - deliberately small,
                                   so many concurrent replays land on the SAME
                                   id and serialize on one index tuple
  --verify-live <apiBaseUrl>      after building the pool, POST its first entry
                                   for real and confirm a 2xx (never a DB check -
                                   this script has no psql dependency)
  --skip-memory-check             skip the pre-flight memory-budget refusal
                                   (#2931) and build the pool regardless of
                                   how much host memory is free
  --memory-safety-fraction <n>    fraction of currently-free host memory the
                                   projected pool is allowed to use, default
                                   0.7 - leaves headroom for the api/worker
                                   containers and anything else on the host
  --help                          this text
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  help();
  process.exit(0);
}

const connectionId = requireArg(args, 'connection-id');
const secret = requireArg(args, 'secret');
const count = Number(requireArg(args, 'count'));
const windowStartMs = Number(requireArg(args, 'window-start-ms'));
const durationSecs = Number(requireArg(args, 'duration-secs'));
const arm = requireArg(args, 'arm');

if (!['unique', 'replay-committed', 'replay-concurrent'].includes(arm)) {
  die(`--arm must be one of unique | replay-committed | replay-concurrent, got '${arm}'`);
}
if (!Number.isFinite(count) || count <= 0) die(`--count must be a positive number, got '${args.count}'`);
if (!Number.isFinite(windowStartMs) || windowStartMs <= 0) die(`--window-start-ms must be a positive epoch-ms, got '${args['window-start-ms']}'`);
if (!Number.isFinite(durationSecs) || durationSecs <= 0) die(`--duration-secs must be a positive number, got '${args['duration-secs']}'`);

const provider = args.provider ?? 'prestashop';
const out = args.out ?? './pool.json';
const genIntervalSecs = Number(args['gen-interval-secs'] ?? 60);
const skewWindowMs = Number(args['skew-window-ms'] ?? 120000);
const payloadBytes = Number(args['payload-bytes'] ?? 256);
const eventType = args['event-type'] ?? 'order.created';
const objectType = args['object-type'] ?? 'order';
const externalIdPrefix = args['external-id-prefix'] ?? 'perf-burst';
const distinctIds = Number(args['distinct-ids'] ?? 5);

if (!Number.isFinite(genIntervalSecs) || genIntervalSecs <= 0) die(`--gen-interval-secs must be positive, got '${args['gen-interval-secs']}'`);
if (!Number.isFinite(skewWindowMs) || skewWindowMs <= 0) die(`--skew-window-ms must be positive, got '${args['skew-window-ms']}'`);
if (!Number.isFinite(payloadBytes) || payloadBytes < 0) die(`--payload-bytes must be >= 0, got '${args['payload-bytes']}'`);

// ---------------------------------------------------------------------------
// § 3.2 - generations, and the skew-window refusal.
//
// Each generation g is stamped windowStartMs + g * genIntervalMs. k6 selects
// a generation from ELAPSED REAL TIME (Date.now() - RUN_START_MS), so the
// pool must carry enough generations to cover the whole planned duration -
// otherwise the tail of the run reuses the LAST generation's now-stale
// timestamp, which will eventually fall outside OL_WEBHOOK_SKEW_WINDOW_MS and
// start 401ing mid-run rather than failing loudly up front.
// ---------------------------------------------------------------------------
const genIntervalMs = genIntervalSecs * 1000;
const durationMs = durationSecs * 1000;
// +1 generation of slack beyond exact coverage, +1 for the zero-indexed first
// generation itself - ceil(duration/interval) covers up to durationMs, and one
// extra generation keeps the LAST generation's own valid window (±skewWindowMs)
// comfortably past the run's true end rather than landing exactly on it.
const nGenerations = Math.ceil(durationMs / genIntervalMs) + 1;
const lastGenOffsetMs = (nGenerations - 1) * genIntervalMs;

if (lastGenOffsetMs + skewWindowMs < durationMs) {
  // This should be structurally unreachable given how nGenerations is derived
  // above - it is asserted explicitly anyway (plan § 3.2: "The pre-signer
  // refuses to build a pool whose last generation would fall outside the
  // window given the configured duration"), so a future change to the
  // nGenerations formula that breaks the invariant fails loudly here instead
  // of producing a pool that silently 401s at minute N of an overnight run.
  die(
    `pool would not cover the full ${durationSecs}s run: last generation is only ` +
      `${(lastGenOffsetMs + skewWindowMs) / 1000}s of skew-legal coverage into the run. ` +
      `Increase --gen-interval-secs is the wrong direction; this is an internal ` +
      `invariant failure - report it rather than working around it.`
  );
}

log(`pool will span ${nGenerations} generation(s), ${genIntervalSecs}s apart, covering ${lastGenOffsetMs / 1000}s (run is ${durationSecs}s)`);

function log(msg) {
  process.stderr.write(`[presign-webhooks] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Payload padding - a filler string sized so the serialized envelope lands
// close to --payload-bytes. Approximate by construction (JSON escaping,
// varying eventId/timestamp lengths mean this is not exact to the byte), and
// the ACTUAL byte length achieved is recorded in meta.actualPayloadBytesSample
// rather than asserted - the manifest states what happened, not what was asked for.
// ---------------------------------------------------------------------------
function buildPayload(fillerLen) {
  const base = { source: 'perf-webhook-burst', filler: '' };
  const baseLen = JSON.stringify(base).length;
  const need = Math.max(0, fillerLen - baseLen);
  return { source: 'perf-webhook-burst', filler: 'x'.repeat(need) };
}
const payload = buildPayload(payloadBytes);

// ---------------------------------------------------------------------------
// eventId supply, per arm (plan § 3.3).
// ---------------------------------------------------------------------------
function loadReuseIds(path) {
  const raw = readTextFile(path);
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const ids = Array.isArray(parsed) ? parsed : parsed.eventIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      die(`--reuse-ids-file ${path} parsed but carried no usable eventIds array`);
    }
    return ids;
  }
  const ids = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  if (ids.length === 0) die(`--reuse-ids-file ${path} is empty`);
  return ids;
}

function readTextFile(path) {
  return readFileSync(path, 'utf8');
}

let idSupply;
if (arm === 'unique') {
  // A fresh id per entry - headline ingress throughput, no index contention.
  idSupply = { mode: 'fresh' };
} else if (arm === 'replay-committed') {
  const reuseFile = requireArg(args, 'reuse-ids-file');
  const ids = loadReuseIds(reuseFile);
  log(`replay-committed: loaded ${ids.length} already-committed id(s) from ${reuseFile}`);
  idSupply = { mode: 'cycle', ids };
} else {
  // replay-concurrent - deliberately SMALL and shared, so many replays in
  // flight at once collide on the SAME id and serialize on one index tuple
  // rather than spreading load across a large, mostly-non-colliding set.
  if (!Number.isFinite(distinctIds) || distinctIds <= 0) die(`--distinct-ids must be positive, got '${args['distinct-ids']}'`);
  const ids = Array.from({ length: distinctIds }, () => `${externalIdPrefix}-concurrent-${randomUUID()}`);
  log(`replay-concurrent: generated ${ids.length} distinct id(s) to be replayed ${count} time(s) total`);
  idSupply = { mode: 'cycle', ids };
}

function nextEventId(i) {
  if (idSupply.mode === 'fresh') return `${externalIdPrefix}-${randomUUID()}`;
  return idSupply.ids[i % idSupply.ids.length];
}

// ---------------------------------------------------------------------------
// One real entry, built the exact same way the main loop below builds one -
// used ONLY to measure the actual serialized byte cost of an entry before
// committing to signing `count` of them. Kept as its own function rather
// than inlined so the pre-flight estimate below and the main loop can never
// silently drift into building two different shapes.
// ---------------------------------------------------------------------------
function buildEntry(i, timestampMs) {
  const eventId = nextEventId(i);
  const envelope = {
    schemaVersion: 1,
    eventId,
    eventType,
    occurredAt: new Date(timestampMs).toISOString(),
    object: { type: objectType, externalId: `${externalIdPrefix}-order-${i}` },
    payload,
  };
  const signed = signWebhook(secret, envelope, timestampMs);
  return { timestampMs, eventId, body: signed.rawBody, signature: signed.headers['X-OpenLinker-Signature'] };
}

// ---------------------------------------------------------------------------
// Pre-flight memory budget (#2931). Refuse to sign `count` entries at all
// when the pool that would result is bigger than this host can hold once
// k6 loads it - discovered live as two OOM kills mid-run, confirmed by
// `dmesg`, in results-F3-2026-09-06.md.
//
// The multiplier and fixed overhead below are NOT a guess - they are read
// off a live measurement of the ACTUAL webhook-burst.js driver (the
// double-SharedArray design that replaced per-VU JSON.parse; see that
// file's own header comment), holding a real ~63 MB flat pool, at both 5
// and 150 virtual users:
//
//   5 VUs:   peak container RSS ~517 MB  (~8.2x the 62.8 MB pool file)
//   150 VUs: peak container RSS ~501 MB  (~8.0x the 62.8 MB pool file)
//
// (a 2 GB cgroup limit; the pre-#2931 per-VU-parse driver, same pool, same
// limit, was OOM-killed with only 5/20 VUs initialized.) i.e. the dominant
// cost is the ONE-TIME cost of parsing the file twice (once per
// SharedArray) into JS-object form, not the VU count - which is exactly the
// property this issue exists to buy: 5 VUs and 150 VUs land within 3% of
// each other. `PARSE_MEMORY_MULTIPLIER` rounds the observed ~8x up to 9x so
// the estimate holds a margin rather than reporting a number that already
// assumes the best case, and `RUNTIME_FIXED_OVERHEAD_BYTES` is slack for a
// smaller pool's fixed k6/goja baseline (which the multiplier alone
// under-covers once the pool itself gets small) and for a bigger box's own
// baseline.
// ---------------------------------------------------------------------------
const PARSE_MEMORY_MULTIPLIER = 9;
const RUNTIME_FIXED_OVERHEAD_BYTES = 100 * 1024 * 1024;
const memorySafetyFraction = Number(args['memory-safety-fraction'] ?? 0.7);
if (!Number.isFinite(memorySafetyFraction) || memorySafetyFraction <= 0 || memorySafetyFraction > 1) {
  die(`--memory-safety-fraction must be in (0, 1], got '${args['memory-safety-fraction']}'`);
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

if (args['skip-memory-check']) {
  log('skipping the pre-flight memory-budget check (--skip-memory-check)');
} else {
  const sample = buildEntry(0, windowStartMs);
  // +1 per entry for the array-element comma; generationIndex + meta are a
  // few hundred bytes total regardless of count and are folded into the
  // fixed overhead instead of measured per-generation.
  const projectedEntriesBytes = (JSON.stringify(sample).length + 1) * count;
  const requiredBytes = Math.round(projectedEntriesBytes * PARSE_MEMORY_MULTIPLIER) + RUNTIME_FIXED_OVERHEAD_BYTES;
  const availableBytes = freemem();
  const budgetBytes = Math.floor(availableBytes * memorySafetyFraction);
  log(
    `memory budget: pool would be ~${mb(projectedEntriesBytes)} MB on disk -> an estimated ` +
      `~${mb(requiredBytes)} MB resident in the k6 process (${PARSE_MEMORY_MULTIPLIER}x measured parse ` +
      `overhead, #2931, + ${mb(RUNTIME_FIXED_OVERHEAD_BYTES)} MB fixed baseline); this host currently has ` +
      `${mb(availableBytes)} MB free, budgeted at ${Math.round(memorySafetyFraction * 100)}% = ${mb(budgetBytes)} MB`
  );
  if (requiredBytes > budgetBytes) {
    die(
      `refusing to build a pool this host cannot hold: need an estimated ~${mb(requiredBytes)} MB resident, ` +
        `only ${mb(budgetBytes)} MB budgeted (${mb(availableBytes)} MB free x ${memorySafetyFraction} safety ` +
        `margin). Lower --count, free memory on the host (stop an idle stack), raise the budget with ` +
        `--memory-safety-fraction, or pass --skip-memory-check to try anyway and risk an OOM kill.`
    );
  }
}

// ---------------------------------------------------------------------------
// Build the pool. Entries are FLAT (#2931 - see the header comment) and
// distributed evenly across generations (the last generation may carry a
// partial share when count is not an exact multiple) - the exact
// distribution is not load-bearing (any generation with any remaining
// entries can serve any request), only that the TOTAL legitimately covers
// `count`. `generationIndex` records, per generation, the contiguous slice
// of `entries` it owns (`startIndex`/`count`) so the k6 driver can pick a
// generation's entries in O(1) without scanning the flat array.
// ---------------------------------------------------------------------------
const perGeneration = Math.ceil(count / nGenerations);
const generationIndex = [];
const entries = [];
let built = 0;
for (let g = 0; g < nGenerations && built < count; g++) {
  const timestampMs = windowStartMs + g * genIntervalMs;
  const take = Math.min(perGeneration, count - built);
  const startIndex = built;
  for (let k = 0; k < take; k++) {
    entries.push(buildEntry(built, timestampMs));
    built++;
  }
  generationIndex.push({ timestampMs, startIndex, count: take });
}

if (built < count) {
  die(`internal error: only built ${built} of ${count} requested entries`);
}

const sampleBytes = entries[0]?.body?.length ?? 0;

const pool = {
  meta: {
    generatedAt: new Date().toISOString(),
    provider,
    connectionId,
    arm,
    count,
    windowStartMs,
    durationSecs,
    genIntervalSecs,
    skewWindowMs,
    nGenerations,
    payloadBytesRequested: payloadBytes,
    payloadBytesActualSample: sampleBytes,
    eventType,
    objectType,
    externalIdPrefix,
    // Never the secret. Never anything the secret could be recovered from.
  },
  generationIndex,
  entries,
};

writeFileSync(out, JSON.stringify(pool));
log(`wrote ${out} (${built} entries across ${generationIndex.length} generation(s), sample entry ${sampleBytes} bytes)`);

// ---------------------------------------------------------------------------
// § 4.3 acceptance - "a unit-ish self-check asserts that a pool entry,
// replayed verbatim, is accepted by the live API (one real POST)". This is
// intentionally the ONLY network call this script ever makes, and only when
// asked - a pre-signer that always phones home would be a surprising thing
// for a pure "write bytes to disk" tool to do.
// ---------------------------------------------------------------------------
if (args['verify-live']) {
  const apiBaseUrl = String(args['verify-live']).replace(/\/$/, '');
  const first = entries[0];
  const firstGenTimestamp = first.timestampMs;
  const url = `${apiBaseUrl}/webhooks/${provider}/${connectionId}`;
  log(`--verify-live: POSTing entry eventId=${first.eventId} to ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenLinker-Timestamp': String(firstGenTimestamp),
      'X-OpenLinker-Signature': first.signature,
    },
    body: first.body,
  });
  const text = await res.text();
  if (res.status < 200 || res.status >= 300) {
    die(`--verify-live: POST returned HTTP ${res.status}: ${text}`);
  }
  log(`--verify-live: OK - HTTP ${res.status} (eventId=${first.eventId} - check webhook_deliveries for its status)`);
}
