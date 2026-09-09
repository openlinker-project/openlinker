#!/usr/bin/env node
/**
 * F12 post-sale-flows HTTP load driver (#2980, epic #2840).
 *
 * Fires a batch of HTTP requests against OpenLinker's API with a stated,
 * verifiable concurrency shape - either:
 *
 *   race  - every request is CREATED (its fetch() call issued) inside one
 *           synchronous loop before any of them is awaited, via Promise.all.
 *           This is what #2980's "genuinely concurrent same-key calls, not
 *           sequential retries" acceptance criterion requires: no request
 *           waits for a prior one's response before it is sent.
 *   pool  - a bounded number of workers pull from a shared queue, so up to
 *           <concurrency> requests are in flight at any instant, sustained
 *           across a larger batch than a single `race` is meant to prove
 *           anything about (a 500-request race would mostly measure this
 *           driver's own event-loop/socket-pool ceiling, not the server).
 *
 * Neither mode staggers requests with a client-side delay - "concurrent"
 * here means what it says, not "issued close together".
 *
 * Input: NDJSON on stdin, one request descriptor per line:
 *   {"id":"...", "method":"POST", "path":"/orders/x/refunds", "body":{...}}
 * Output: NDJSON on stdout, one result per line, in COMPLETION order (not
 * necessarily input order - a caller correlating results back to inputs must
 * join on `id`):
 *   {"id":..., "method":..., "path":..., "status":N, "ok":bool,
 *    "startedAtMs":N, "durationMs":N, "error":null|string,
 *    "responseErrorField":null|string, "responseBody":string|null}
 *
 * A request this driver could not even send (DNS failure, connection reset)
 * is reported with status:0, ok:false and a non-null `error` - never
 * silently dropped and never counted as a 2xx. This mirrors the
 * `docs/lessons.md` rule for `ps_sql`/`pg_sql`: a read (here, a fetch) that
 * fails must report that failure as a value the caller can tell apart from
 * a real answer, not fold it into "0" or "ok".
 *
 * @module perf/openlinker-throughput/drivers
 */
import { readFileSync } from 'node:fs';

const [, , baseUrl, token, mode, concurrencyArg] = process.argv;
if (!baseUrl || !token || !mode || (mode !== 'race' && mode !== 'pool')) {
  process.stderr.write(
    'usage: post-sale-flows.mjs <baseUrl> <token> <race|pool> [poolConcurrency] < requests.ndjson > results.ndjson\n'
  );
  process.exit(2);
}
const concurrency = Math.max(1, Number(concurrencyArg || '20') || 20);

const input = readFileSync(0, 'utf8');
const requests = input
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (requests.length === 0) {
  process.stderr.write('post-sale-flows.mjs: no requests on stdin - nothing to fire\n');
  process.exit(0);
}

/**
 * Fire one request and ALWAYS resolve (never reject) - a rejected promise
 * inside Promise.all would abort every sibling request still in flight,
 * which is exactly backwards for a driver whose whole point is observing
 * how many concurrent attempts land where.
 */
async function fireOne(reqDesc) {
  const startedAtMs = Date.now();
  const url = `${baseUrl}${reqDesc.path}`;
  const hasBody = reqDesc.body !== undefined && reqDesc.body !== null;
  try {
    const resp = await fetch(url, {
      method: reqDesc.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: hasBody ? JSON.stringify(reqDesc.body) : undefined,
    });
    const durationMs = Date.now() - startedAtMs;
    let bodyText = '';
    try {
      bodyText = await resp.text();
    } catch {
      bodyText = '';
    }
    let errorField = null;
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        errorField = parsed.error ?? parsed.message ?? null;
      } catch {
        // Not JSON - keep errorField null, responseBody still carries it.
      }
    }
    return {
      id: reqDesc.id,
      method: reqDesc.method,
      path: reqDesc.path,
      status: resp.status,
      ok: resp.ok,
      startedAtMs,
      durationMs,
      error: null,
      responseErrorField: errorField,
      responseBody: bodyText ? bodyText.slice(0, 2000) : null,
    };
  } catch (error) {
    return {
      id: reqDesc.id,
      method: reqDesc.method,
      path: reqDesc.path,
      status: 0,
      ok: false,
      startedAtMs,
      durationMs: Date.now() - startedAtMs,
      error: error instanceof Error ? error.message : String(error),
      responseErrorField: null,
      responseBody: null,
    };
  }
}

async function runRace(reqs) {
  return Promise.all(reqs.map((r) => fireOne(r)));
}

async function runPool(reqs, limit) {
  const results = [];
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= reqs.length) return;
      results.push(await fireOne(reqs[i]));
    }
  }
  const workers = Array.from({ length: Math.min(limit, reqs.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const batchStartedAtMs = Date.now();
const results = mode === 'race' ? await runRace(requests) : await runPool(requests, concurrency);
const batchDurationMs = Date.now() - batchStartedAtMs;

for (const r of results) {
  process.stdout.write(JSON.stringify(r) + '\n');
}
process.stderr.write(
  `post-sale-flows.mjs: mode=${mode} concurrency=${mode === 'pool' ? concurrency : results.length} ` +
    `n=${results.length} wallMs=${batchDurationMs}\n`
);
