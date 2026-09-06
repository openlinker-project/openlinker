#!/usr/bin/env node
/**
 * Lighthouse Mock API Server (#2866)
 *
 * A tiny, dependency-free HTTP stub standing in for `apps/api` while
 * Lighthouse audits a built `apps/web/dist`. It exists so the Lighthouse
 * run measures ONLY the frontend artifact under test, against a fixed,
 * network-idle-fast backend — never a live dev/demo stack, which on this
 * host is shared with other running measurements and would make every
 * score a statement about contention rather than about this bundle.
 *
 * It answers exactly two endpoints with real semantics (auth), and every
 * other `/v1/**` GET/POST/PATCH/DELETE with a generic 200 envelope. That is
 * safe here specifically because `apps/web`'s query hooks are written
 * defensively (`data?.total ?? null`, `data?.length ?? null` — see
 * `apps/web/src/app/hooks/use-nav-counts.ts`), per the frontend rule to
 * "Always handle all states: loading → error → empty → data." A generic
 * empty envelope is therefore read as "no data yet," not as an error.
 *
 * This is deliberately NOT a full API mock — it does not validate request
 * bodies, does not model any domain, and must never be reused for anything
 * that asserts business behaviour. Its only job is to let the SPA reach a
 * rendered, non-error, non-loading state so Lighthouse measures real paint
 * and interactivity timing rather than an infinite spinner.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.LH_MOCK_API_PORT ?? 4174);
const ALLOWED_ORIGIN = process.env.LH_MOCK_ORIGIN ?? 'http://localhost:4173';

const GENERIC_LIST_ENVELOPE = {
  data: [],
  items: [],
  total: 0,
  totalCount: 0,
  page: 1,
  limit: 20,
  hasMore: false,
};

const STUB_USER = {
  id: 'ol_user_lighthouse',
  username: 'lighthouse',
  email: 'lighthouse@openlinker.test',
  role: 'admin',
  permissions: ['*'],
  analyticsConsent: false,
};

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-CSRF-Token, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  res.end(json);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  // Path carries the api-version prefix from `withApiVersion` (#1133), e.g.
  // `/v1/auth/refresh`. Matched with `.endsWith` so the prefix is opaque here.
  if (req.method === 'POST' && url.pathname.endsWith('/auth/refresh')) {
    send(res, 200, { access_token: 'lighthouse-stub-token' });
    return;
  }
  if (req.method === 'GET' && url.pathname.endsWith('/auth/me')) {
    send(res, 200, STUB_USER);
    return;
  }
  if (req.method === 'GET' && url.pathname.endsWith('/connections')) {
    // useConnectionsQuery reads an unpaginated ARRAY (#2840's own finding),
    // never the wrapped envelope every other list endpoint uses.
    send(res, 200, []);
    return;
  }
  if (req.method === 'POST' && url.pathname.endsWith('/auth/logout')) {
    send(res, 200, {});
    return;
  }

  // Catch-all: every other read is "no data yet", every other write is a
  // no-op success. Real domain shapes are deliberately not modelled here.
  if (req.method === 'GET') {
    send(res, 200, GENERIC_LIST_ENVELOPE);
    return;
  }
  send(res, 200, {});
});

server.listen(PORT, () => {
  console.log(`[lighthouse-mock-api] listening on :${PORT}, allowing origin ${ALLOWED_ORIGIN}`);
});
