#!/usr/bin/env node
/**
 * Outbound HTTP Bypass Guard (#1810)
 *
 * Every plugin HTTP client is meant to go through the connection-bound
 * transport (`HostServices.http` / `HttpTransportFactoryPort.for(connection)`)
 * so a connection's `config.rateLimit` can't be silently bypassed by a bare
 * `fetch()` call. This is the filesystem-level twin of the ESLint
 * `no-restricted-globals: fetch` rule in `.eslintrc.js` — independent
 * enforcement so a lint-config regression (or a package the ESLint override
 * doesn't yet cover) doesn't silently let a bypass back in.
 *
 * Scope: currently `libs/integrations/prestashop/**` only — the reference
 * adopter (#1772). Widens to `libs/integrations/**` once the remaining 8
 * clients are migrated (#1810 Phase 5, tracked in #1956); see the identical
 * scope note on the ESLint override.
 *
 * A bare `fetch(` call is allowed only with an explicit, scoped exemption
 * comment on the immediately preceding line
 * (`// eslint-disable-next-line no-restricted-globals -- <reason>`) — never
 * a blanket file-level suppression. No such exemption exists in the current
 * scope; the allowance exists for the OAuth-token bypasses Phase 5 will add
 * in the other 8 packages once their scope is included here.
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
const SCAN_ROOTS = ['libs/integrations/prestashop'];

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

const EXEMPTION_PATTERN = /eslint-disable-next-line\s+no-restricted-globals/;
// A bare, un-namespaced `fetch(` call — not `.fetch(` (member access on some
// object) and not `fetchImpl(`/`fetchSomething(` (a longer identifier).
const BARE_FETCH_PATTERN = /(?<![.\w])fetch\s*\(/;

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
 * Pure classifier: given a file's source text, return one entry per
 * unexempted bare `fetch(` call. Line numbers are 1-indexed.
 */
export function findBareFetchCalls(content) {
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
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
        'HttpTransportFactoryPort.for(connection)) instead, or add a scoped\n' +
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
