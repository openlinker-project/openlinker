#!/usr/bin/env node
/**
 * Outbound HTTP Bypass Guard (#1810)
 *
 * Every plugin HTTP client is meant to go through the connection-bound
 * transport (`HostServices.http` / `HttpTransportFactoryPort.forConnection(connection)`)
 * so a connection's `config.rateLimit` can't be silently bypassed by a bare
 * `fetch()` call. This is the filesystem-level twin of the ESLint
 * `no-restricted-globals: fetch` rule in `.eslintrc.js` — independent
 * enforcement so a lint-config regression (or a package the ESLint override
 * doesn't yet cover) doesn't silently let a bypass back in.
 *
 * Scope: PrestaShop (reference adopter, #1772) + each Phase 5 client as it
 * migrates (#1810, tracked in #1956) — see the identical scope note on the
 * ESLint override, which this mirrors.
 *
 * A bare `fetch(` call is allowed only with an explicit, scoped exemption
 * comment on the immediately preceding line
 * (`// eslint-disable-next-line no-restricted-globals -- <reason>`) — never
 * a blanket file-level suppression. Used today for the 3 Allegro OAuth-token
 * bypasses (exchangeCode/fetchAccountIdentity, callRefreshEndpoint,
 * fetchSellerIdentity) and Erli's Allegro-app OAuth token bypass
 * (`acquireToken` in `allegro-category-catalog-client.ts`) — low-volume auth
 * infra, not shop traffic. InPost has no OAuth-token bypass to exempt (static
 * Bearer API token, no token endpoint). No such exemption is needed for
 * KSeF, Subiekt, or Infakt — none of those clients has an ad-hoc
 * OAuth-token bypass.
 * KSeF or Subiekt — neither client has an ad-hoc OAuth-token bypass. DPD
 * Polska's HTTP clients and connection tester route through an injected
 * `fetchImpl` too, with no ad-hoc OAuth-token bypass to exempt.
 * KSeF or Subiekt — neither client has an ad-hoc OAuth-token bypass.
 * WooCommerce also has no OAuth-token bypass to exempt (Basic Auth via
 * consumer key/secret, no token endpoint).
 *
 * Run with `--self-check` to exercise the pure classifier against synthetic
 * inputs (no filesystem) — mirrors `check-migration-timestamps.mjs --self-check`.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
 *
 * Exits non-zero on a violation, with one line per hit to stderr.
 *
 * @module scripts
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

/** Directories scanned for bare outbound `fetch()` calls. Widens in Phase 5. */
const SCAN_ROOTS = [
  'libs/integrations/prestashop',
  'libs/integrations/allegro',
  'libs/integrations/dpd-polska',
  'libs/integrations/erli',
  'libs/integrations/fx',
  'libs/integrations/infakt',
  'libs/integrations/inpost',
  'libs/integrations/ksef',
  'libs/integrations/subiekt',
  'libs/integrations/woocommerce',
  // #2390 / ADR-055: the OL-OMS answers from OpenLinker's own tables, not a
  // vendor API — there is no network boundary to adapt across, and adding one
  // would put an HTTP hop on the ATP publish hot path for an in-process
  // consumer (DESIGN §9). Scanned so that stays an enforced fact.
  'libs/oms',
];

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

const EXEMPTION_PATTERN = /eslint-disable-next-line\s+no-restricted-globals/;
// Two shapes of unmetered outbound call:
//
//  1. A bare, un-namespaced `fetch(` call — not `.fetch(` (member access on
//     some object) and not `fetchImpl(`/`fetchSomething(` (a longer
//     identifier). This is the shape `no-restricted-globals` also catches;
//     scanning for it is a backstop against a lint-config regression.
//  2. A `globalThis.fetch` / `global.fetch` / `window.fetch` REFERENCE, with
//     or without a call. `no-restricted-globals` structurally cannot see
//     these — it flags the bare identifier `fetch`, not a member expression —
//     so here the checker is the ONLY guard, not a backstop. The reference
//     form matters as much as the call form: `const f = x ?? globalThis.fetch`
//     hands an unmetered transport to a call site far away.
//
// Single-line patterns by design (scanned per-line below) — a call split
// across lines (`fetch(\n  url,\n  ...\n)`) will not match. The
// low-likelihood multi-line-call gap is accepted.
const BARE_FETCH_PATTERN = /(?<![.\w])fetch\s*\(|(?<![.\w])(?:globalThis|global|window)\s*\.\s*fetch\b/;

function isTestFile(relPath) {
  return relPath.endsWith('.spec.ts') || relPath.endsWith('.int-spec.ts');
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name);
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      yield* walk(abs);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield abs;
    }
  }
}

/**
 * True for a line that is entirely a comment (a line comment `// ...`, a
 * block-comment opener `/* ...`, or a JSDoc/block continuation `* ...`) — a
 * coarse, line-oriented heuristic (no real tokenizer), good enough for this
 * invariant: a genuine `fetch(` call is never itself comment text, only ever
 * *mentioned* in one (e.g. a JSDoc description).
 *
 * A block comment that CLOSES on the same line and is followed by code
 * (`/* legacy *\/ await fetch(url)`) is code, not comment — skipping it would
 * hand a bypass exactly the escape hatch this guard exists to deny.
 */
function isCommentOnlyLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//')) return true;
  if (!trimmed.startsWith('/*') && !trimmed.startsWith('*')) return false;
  const closedAt = trimmed.lastIndexOf('*/');
  return closedAt === -1 || trimmed.slice(closedAt + 2).trim() === '';
}

/**
 * Pure classifier: given a file's source text, return one entry per
 * unexempted bare `fetch(` call. Line numbers are 1-indexed.
 */
export function findBareFetchCalls(content) {
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (isCommentOnlyLine(lines[i])) continue;
    if (!BARE_FETCH_PATTERN.test(lines[i])) continue;
    const prevLine = i > 0 ? lines[i - 1] : '';
    if (EXEMPTION_PATTERN.test(prevLine)) continue;
    hits.push({ line: i + 1, snippet: lines[i].trim() });
  }
  return hits;
}

async function main() {
  const violations = [];

  for (const scanRoot of SCAN_ROOTS) {
    for await (const abs of walk(resolve(ROOT, scanRoot))) {
      const rel = relative(ROOT, abs);
      if (isTestFile(rel)) continue;

      let content;
      try {
        content = await readFile(abs, 'utf8');
      } catch {
        continue;
      }

      for (const hit of findBareFetchCalls(content)) {
        violations.push({ file: rel, ...hit });
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('check-outbound-http: bare fetch() calls found outside HostServices.http\n');
    for (const v of violations) {
      process.stderr.write(`  ${v.file}:${v.line} — ${v.snippet}\n`);
    }
    process.stderr.write(
      '\nRoute the call through the connection-bound transport (HostServices.http /\n' +
        'HttpTransportFactoryPort.forConnection(connection)) instead, or add a scoped\n' +
        '`// eslint-disable-next-line no-restricted-globals -- <reason>` exemption\n' +
        'immediately above the call (e.g. an OAuth token endpoint).\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    `check-outbound-http: OK (scanned ${SCAN_ROOTS.length} root${SCAN_ROOTS.length === 1 ? '' : 's'})\n`,
  );
}

function selfCheck() {
  const cases = [
    {
      name: 'flags a bare fetch( call',
      content: 'const res = await fetch(url, { method: "GET" });',
      expectHits: 1,
    },
    {
      name: 'does not flag this.fetchImpl(',
      content: 'const res = await this.fetchImpl(url, {});',
      expectHits: 0,
    },
    {
      name: 'does not flag a longer identifier ending in fetch-like text',
      content: 'const res = await prefetch(url);',
      expectHits: 0,
    },
    {
      name: 'does not flag member-access .fetch(',
      content: 'const res = await httpClient.fetch(url);',
      expectHits: 0,
    },
    {
      name: 'honours an immediately-preceding scoped exemption comment',
      content:
        '// eslint-disable-next-line no-restricted-globals -- OAuth token endpoint\nconst res = await fetch(url);',
      expectHits: 0,
    },
    {
      name: 'still flags when the exemption comment is not on the immediately preceding line',
      content:
        '// eslint-disable-next-line no-restricted-globals -- OAuth token endpoint\n\nconst res = await fetch(url);',
      expectHits: 1,
    },
    {
      name: 'flags a globalThis.fetch reference (no-restricted-globals cannot see it)',
      content: 'const fetchImpl = options?.fetchImpl ?? globalThis.fetch;',
      expectHits: 1,
    },
    {
      name: 'flags a window.fetch call',
      content: 'const res = await window.fetch(url);',
      expectHits: 1,
    },
    {
      name: 'honours an exemption above a globalThis.fetch reference',
      content:
        '// eslint-disable-next-line no-restricted-globals -- master-shop image bytes\nconst fetchImpl = options?.fetchImpl ?? globalThis.fetch;',
      expectHits: 0,
    },
    {
      name: 'does not flag an unrelated member named fetch on some object',
      content: 'const res = await this.fetchImpl(url);',
      expectHits: 0,
    },
    {
      name: 'does not flag a JSDoc line mentioning fetch(',
      content: ' * Format a thrown value from `fetch()` into an operator-actionable string.',
      expectHits: 0,
    },
    {
      name: 'does not flag a line comment mentioning fetch(',
      content: '// Convert Headers to plain object for fetch (Node.js fetch may have issues)',
      expectHits: 0,
    },
    {
      name: 'flags a real fetch( that follows a closed block comment on the same line',
      content: '/* legacy path */ const res = await fetch(url);',
      expectHits: 1,
    },
    {
      name: 'does not flag a self-closed block comment that only mentions fetch(',
      content: '/* falls back to fetch() when unset */',
      expectHits: 0,
    },
  ];

  let failed = false;
  for (const testCase of cases) {
    const hits = findBareFetchCalls(testCase.content);
    if (hits.length !== testCase.expectHits) {
      failed = true;
      console.error(
        `✗ check-outbound-http --self-check: "${testCase.name}" — expected ${testCase.expectHits} hit(s), got ${hits.length}`,
      );
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log(`✓ check-outbound-http --self-check: ${cases.length} classifier case(s) passed.`);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  await main();
}
