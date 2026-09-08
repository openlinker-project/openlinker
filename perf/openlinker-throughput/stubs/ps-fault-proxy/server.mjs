/**
 * PrestaShop fault-injection proxy (#2978, epic #2840).
 *
 * A transparent HTTP reverse proxy that sits between OpenLinker and the real
 * local PrestaShop on the `lab` stand, and can be told - at runtime, from a
 * scenario script - to break a chosen slice of the traffic passing through
 * it.
 *
 * WHY A PROXY AND NOT A STUB
 * --------------------------
 * #2978 measures behaviour under dependency failure, and every other flow in
 * the #2840 campaign measured the REAL PrestaShop (#2860's own requirement
 * for a destination figure). Replacing it with a mock for this one issue
 * would change two variables at once: the fault, and the destination. A proxy
 * changes exactly one - every request that is not selected for a fault
 * reaches the same PrestaShop, gets the same answer, and takes the same time
 * as it does in every other window of the campaign.
 *
 * The `wc-tls` nginx service on this stand is the precedent #2978 names for
 * putting something in front of a stand dependency. nginx is not used here
 * for three reasons it cannot satisfy without a Lua build: a per-request
 * PROBABILITY, matching on request path AND method together, and holding a
 * connection open without answering (the timeout fault) while still counting
 * it.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a load balancer, not a cache, and not a rate limiter. It adds one
 * TCP hop and nothing else. Its own overhead is measured and reported by the
 * scenario's baseline window - a window with a rule installed at
 * `fraction: 0` - so the proxy's cost is never confused with a fault's cost.
 *
 * HOW OPENLINKER IS POINTED AT IT
 * -------------------------------
 * The `perf-prestashop` connection's `config.baseUrl` is PATCHed from
 * `http://prestashop` to `http://ps-fault-proxy:8080` for the duration of the
 * run, and PATCHed back on exit. Nothing in docker-compose.lab.yml changes,
 * no existing container is recreated, and `post_guard_containers_stable`
 * therefore still means what it means in every other scenario.
 *
 * THE HOST HEADER IS REWRITTEN, DELIBERATELY
 * ------------------------------------------
 * Outgoing requests carry `Host: prestashop`, not `Host: ps-fault-proxy`, so
 * PrestaShop sees byte-identical requests to the ones it serves in every
 * other window. PrestaShop generates absolute URLs from the host it is given
 * and can redirect on a mismatch; leaving the proxy's own host in place would
 * have introduced a second difference alongside the fault.
 *
 * CONTROL SURFACE (never proxied)
 * -------------------------------
 *   GET    /__fault/health          -> {ok, upstream, runId}
 *   GET    /__fault/stats           -> counters, per path bucket
 *   POST   /__fault/reset           -> zero the counters, keep the rule
 *   GET    /__fault                 -> the active rule (or null)
 *   POST   /__fault                 -> install a rule
 *   DELETE /__fault                 -> remove the rule
 *
 * A rule:
 *   {
 *     mode: '500' | '429' | 'hang' | 'reset',
 *     fraction: 0..1,              // per-request probability, default 1
 *     pathIncludes: string | null, // substring of the request path
 *     methods: string[] | null,    // e.g. ["POST"]; null = any
 *     retryAfterSeconds: n | null, // '429' only; null OMITS the header
 *     hangMs: n                    // 'hang' only, default 45000
 *   }
 *
 * `fraction` is a per-request coin flip, not a deterministic every-Nth. A
 * deterministic selector would interact with OpenLinker's own retry ladder in
 * a way that is hard to reason about (a request retried immediately would
 * land on a different slot and succeed by construction), and the question
 * #2978 asks is about a shop that hiccups, which is probabilistic. The
 * consequence is that the DELIVERED fault count is not the requested
 * fraction - so the proxy counts what it actually did and the scenario reads
 * that number rather than assuming it.
 *
 * `retryAfterSeconds: null` is a distinct, meaningful state and not merely
 * "unset": #2978 asks for 429 both WITH and WITHOUT `Retry-After`, because
 * OpenLinker's deferral path reads that header, so the two are different
 * measurements. `undefined` in the request body means "use the default 5";
 * an explicit `null` means "send no header at all".
 *
 * Zero dependencies (node:http / node:crypto only), same posture as the
 * Allegro stub next door.
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const CONFIG = {
  port: Number.parseInt(process.env.PROXY_PORT || '8080', 10),
  upstreamHost: process.env.PROXY_UPSTREAM_HOST || 'prestashop',
  upstreamPort: Number.parseInt(process.env.PROXY_UPSTREAM_PORT || '80', 10),
  // The Host header sent upstream. Defaults to the upstream host so the
  // origin sees what it sees with no proxy in the path at all.
  upstreamHostHeader: process.env.PROXY_UPSTREAM_HOST_HEADER || process.env.PROXY_UPSTREAM_HOST || 'prestashop',
  gitSha: process.env.PROXY_GIT_SHA || 'unknown',
};

// What a `429` rule sends when the caller named no value. Declared once and
// applied at rule-install time, never at send time.
const DEFAULT_RETRY_AFTER_SECONDS = 5;

const state = {
  runId: process.env.PROXY_RUN_ID || randomUUID().slice(0, 8),
  rule: null,
  counters: {
    total: 0,
    proxied: 0,
    faulted: 0,
    upstreamError: 0,
    byMode: {},
    // Per path bucket, so a scenario can say "the cart calls succeeded and the
    // importorder call failed" from the proxy's own numbers rather than from
    // OpenLinker's logs. Bucketed rather than raw-pathed: PrestaShop
    // webservice URLs carry ids and query strings, and an unbounded key space
    // would grow without limit inside one window.
    byBucket: {},
  },
};

/**
 * Which of PrestaShop's two request families a path belongs to, and which
 * endpoint within it.
 *
 * OpenLinker reaches PrestaShop over two DIFFERENT surfaces, and the order
 * create path uses both - which is what makes the partial-create fault
 * #2978 asks for expressible at all:
 *
 *   /api/<resource>[/<id>]?ws_key=...     the webservice (cart, customer,
 *                                          address, product reads)
 *   /index.php?fc=module&module=openlinker&controller=<c>
 *                                          the OL module's own front
 *                                          controllers - `cartshipping` and
 *                                          `importorder` (ADR-016)
 *
 * The front-controller path is `/index.php?...`, NOT `/module/...`, and it
 * multiplexes on `controller=`, not on `action=`. Both details are read from
 * `prestashop-openlinker-module.client.ts`'s own CARTSHIPPING_PATH /
 * IMPORTORDER_PATH constants rather than guessed - getting either wrong
 * buckets every module call as `other` and makes the partial-create fault
 * silently unattributable.
 *
 * Bucketed rather than raw-pathed: webservice URLs carry ids and a ws_key
 * query string, so an unbounded key space would grow without limit inside
 * one window (and would put a credential in the counters).
 */
function bucketOf(path) {
  const moduleMatch = /[?&]controller=([a-zA-Z0-9_-]+)/.exec(path);
  if (path.includes('module=openlinker')) {
    return moduleMatch ? `module:${moduleMatch[1]}` : 'module:unknown';
  }
  if (path.startsWith('/api/')) {
    const seg = path.slice(5).split(/[/?]/)[0];
    return `api:${seg || 'root'}`;
  }
  return 'other';
}

function bump(bucket, field) {
  const b = (state.counters.byBucket[bucket] ??= { total: 0, proxied: 0, faulted: 0 });
  b[field] += 1;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function ruleMatches(rule, req, path) {
  if (!rule) return false;
  if (rule.methods && !rule.methods.includes(req.method)) return false;
  if (rule.pathIncludes && !path.includes(rule.pathIncludes)) return false;
  // The coin flip is LAST, so a request excluded by path or method never
  // consumes a draw - otherwise the delivered fraction would depend on how
  // much unrelated traffic shared the window.
  return Math.random() < (rule.fraction ?? 1);
}

/**
 * Applies a matched rule. Returns true if the response is fully handled.
 */
function applyFault(rule, req, res, bucket) {
  state.counters.faulted += 1;
  state.counters.byMode[rule.mode] = (state.counters.byMode[rule.mode] || 0) + 1;
  bump(bucket, 'faulted');

  if (rule.mode === '500') {
    // A shape PrestaShop itself produces: an HTML 500 from the PHP layer, not
    // a JSON error. An adapter that only ever saw well-formed JSON errors is
    // part of what this measures.
    const body = '<!DOCTYPE html><html><head><title>500</title></head><body><h1>Internal server error</h1></body></html>';
    res.writeHead(500, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return true;
  }

  if (rule.mode === '429') {
    const headers = { 'Content-Type': 'text/plain' };
    // `null` is the ONLY value that suppresses the header, and the rule as
    // stored already carries the resolved number for every other case (see
    // the POST handler) - so what `GET /__fault` reports and what goes on
    // the wire cannot disagree.
    const ra = rule.retryAfterSeconds;
    if (ra !== null && ra !== undefined) headers['Retry-After'] = String(ra);
    const body = 'Too Many Requests';
    headers['Content-Length'] = Buffer.byteLength(body);
    res.writeHead(429, headers);
    res.end(body);
    return true;
  }

  if (rule.mode === 'hang') {
    // Hold the connection open without answering. The socket is destroyed
    // after hangMs so the proxy cannot leak sockets across a long window;
    // hangMs must exceed the client's own timeout for this to measure a
    // client-side timeout rather than a slow success.
    const hangMs = rule.hangMs ?? 45000;
    let settled = false;
    req.on('close', () => {
      settled = true;
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        res.destroy();
      } catch {
        /* the socket may already be gone */
      }
    }, hangMs);
    return true;
  }

  if (rule.mode === 'reset') {
    // A mid-flight connection drop, distinct from a hang: the client learns
    // immediately rather than waiting out its timeout.
    try {
      req.socket.destroy();
    } catch {
      /* already gone */
    }
    return true;
  }

  return false;
}

function proxyRequest(req, res, bodyBuf, bucket) {
  const headers = { ...req.headers, host: CONFIG.upstreamHostHeader };
  // Content-Length is recomputed from the buffer we actually hold; a
  // transfer-encoding the origin did not ask for would be a second difference.
  delete headers['transfer-encoding'];
  if (bodyBuf.length > 0) headers['content-length'] = String(bodyBuf.length);

  const upstream = http.request(
    {
      host: CONFIG.upstreamHost,
      port: CONFIG.upstreamPort,
      method: req.method,
      path: req.url,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    state.counters.upstreamError += 1;
    if (!res.headersSent) {
      sendJson(res, 502, { error: 'ps-fault-proxy: upstream error', detail: String(err && err.message) });
    } else {
      try {
        res.destroy();
      } catch {
        /* already gone */
      }
    }
  });

  state.counters.proxied += 1;
  bump(bucket, 'proxied');
  if (bodyBuf.length > 0) upstream.write(bodyBuf);
  upstream.end();
}

const server = http.createServer(async (req, res) => {
  const path = req.url || '/';

  // ---- control surface, never proxied, never faulted -------------------
  if (path.startsWith('/__fault')) {
    if (req.method === 'GET' && path.startsWith('/__fault/health')) {
      sendJson(res, 200, {
        ok: true,
        runId: state.runId,
        gitSha: CONFIG.gitSha,
        upstream: `http://${CONFIG.upstreamHost}:${CONFIG.upstreamPort}`,
        upstreamHostHeader: CONFIG.upstreamHostHeader,
      });
      return;
    }
    if (req.method === 'GET' && path.startsWith('/__fault/stats')) {
      sendJson(res, 200, { runId: state.runId, rule: state.rule, counters: state.counters });
      return;
    }
    if (req.method === 'POST' && path.startsWith('/__fault/reset')) {
      state.counters = { total: 0, proxied: 0, faulted: 0, upstreamError: 0, byMode: {}, byBucket: {} };
      sendJson(res, 200, { reset: true, rule: state.rule });
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, { rule: state.rule });
      return;
    }
    if (req.method === 'DELETE') {
      state.rule = null;
      sendJson(res, 200, { rule: null });
      return;
    }
    if (req.method === 'POST') {
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      const modes = ['500', '429', 'hang', 'reset'];
      if (!modes.includes(body.mode)) {
        sendJson(res, 400, { error: `mode must be one of ${modes.join(', ')}` });
        return;
      }
      const fraction = body.fraction === undefined ? 1 : Number(body.fraction);
      if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
        sendJson(res, 400, { error: 'fraction must be a number in [0,1]' });
        return;
      }
      if (body.methods !== undefined && body.methods !== null && !Array.isArray(body.methods)) {
        sendJson(res, 400, { error: 'methods must be an array of HTTP verbs, or null' });
        return;
      }
      state.rule = {
        mode: body.mode,
        fraction,
        pathIncludes: typeof body.pathIncludes === 'string' && body.pathIncludes ? body.pathIncludes : null,
        methods: Array.isArray(body.methods) ? body.methods.map((m) => String(m).toUpperCase()) : null,
        // Two states are STORED, not three: a number, or an explicit null
        // meaning "send no header". An absent value is resolved to the
        // default HERE rather than in applyFault, so the rule the control
        // surface reports is byte-for-byte the rule that goes on the wire -
        // the reported-equals-enforced rule (#2229). Resolving it at send
        // time instead left `undefined` reaching applyFault's
        // `ra !== undefined` test, which suppressed the header on every
        // default 429 while `GET /__fault` and the manifest both claimed one
        // was being sent. The proxy's own self-test found that, before any
        // window was spent on it.
        retryAfterSeconds:
          body.retryAfterSeconds === null
            ? null
            : Number.isInteger(body.retryAfterSeconds)
              ? body.retryAfterSeconds
              : DEFAULT_RETRY_AFTER_SECONDS,
        hangMs: Number.isInteger(body.hangMs) ? body.hangMs : undefined,
      };
      sendJson(res, 200, { rule: state.rule });
      return;
    }
    sendJson(res, 405, { error: 'method not allowed on the control surface' });
    return;
  }

  // ---- proxied traffic --------------------------------------------------
  const bucket = bucketOf(path);
  state.counters.total += 1;
  bump(bucket, 'total');

  // The body is buffered BEFORE the fault decision so that a faulted request
  // has still been fully read off the wire. A client whose request body was
  // never drained can observe a write error instead of the status we chose,
  // which would make a 500 fault indistinguishable from a connection reset.
  let bodyBuf;
  try {
    bodyBuf = await readBody(req);
  } catch {
    return;
  }

  if (ruleMatches(state.rule, req, path)) {
    if (applyFault(state.rule, req, res, bucket)) return;
  }

  proxyRequest(req, res, bodyBuf, bucket);
});

// Long enough to outlast a `hang` fault plus the client's own timeout; the
// node default of 0 (no timeout) would be fine too, but an explicit value
// states that holding a socket open is intended here rather than accidental.
server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 65000;

const isMain = process.argv[1] && process.argv[1].endsWith('server.mjs');
if (isMain) {
  server.listen(CONFIG.port, () => {
    process.stdout.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        event: 'listening',
        runId: state.runId,
        port: CONFIG.port,
        upstream: `http://${CONFIG.upstreamHost}:${CONFIG.upstreamPort}`,
      })}\n`,
    );
  });
}

export { server, CONFIG, state, bucketOf, ruleMatches };
