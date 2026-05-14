#!/usr/bin/env node
/**
 * Adapter Scaffolder Output Drift Guard (#684)
 *
 * Imports the exported `scaffoldAdapter` from `scripts/create-adapter.mjs`,
 * scaffolds into `os.tmpdir()` for two slugs per run (one non-hyphenated,
 * one hyphenated), and asserts:
 *
 *   1. The set of files produced equals the expected substituted-name set
 *      derived from `scripts/create-adapter-templates/` (no missing, no
 *      unexpected). Per-run, both slugs must produce the same file count.
 *   2. Every output file is clean of the four substitution tokens
 *      (`__name__`, `__Name__`, `__camelName__`, `__BRAND__`) — catches
 *      forgotten-spot bugs.
 *   3. The expected file count (constant `EXPECTED_FILE_COUNT`) matches
 *      the actual output count — catches "template added but invariant
 *      not bumped" drift.
 *   4. **Hyphenated-slug syntax check**: for every `*.ts` file in the
 *      hyphenated-slug run, fail if a top-level `export const`, re-export
 *      list, or right-hand-side identifier reference contains a `-`
 *      (which would parse as the subtraction operator). Catches the #698
 *      bug class — `__name__` accidentally re-used in a TypeScript
 *      identifier slot where `__camelName__` is required. Heuristic
 *      (regex-based, not a real parser); CI `scaffold-smoke.yml` runs the
 *      authoritative `tsc -b` check on the same hyphenated output.
 *
 * Out of scope (intentionally — covered by CI `scaffold-smoke.yml`,
 * shipped via #686 / #695): full `tsc --noEmit` smoke. Pre-commit budget
 * for existing invariants is sub-second; the install + tsc dance would
 * push that to ~15s.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
 *
 * Exits non-zero on drift, with one line per violation to stderr.
 *
 * @module scripts
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { scaffoldAdapter } from './create-adapter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = resolve(ROOT, 'scripts/create-adapter-templates');

// Bump this when a template is added or removed. The constant exists so
// the maintainer's eye catches an unintended count change — relying on
// the templates-dir walk alone wouldn't.
const EXPECTED_FILE_COUNT = 14;

/**
 * The two slugs exercised per run.
 *  - `lintcheck` — non-hyphenated sanity case. For this slug
 *    `__camelName__` resolves to the same string as `__name__`, so the
 *    leftover-token check still exercises all four tokens but the
 *    identifier-syntax check (assertion 4) does nothing — `-` cannot
 *    appear in the output.
 *  - `smoke-test` — hyphenated. Specifically exercises the
 *    `__camelName__` path; this is the run that the identifier-syntax
 *    check guards.
 */
const SCAFFOLD_SLUGS = ['lintcheck', 'smoke-test'];

/**
 * Mirror of `toPascalCase` in `scripts/create-adapter.mjs`. Kept inline so
 * this check exercises the same logic the scaffolder uses; if the slug
 * grows hyphens (`lint-check` → `LintCheck`) both sides agree without a
 * second edit.
 */
function toPascalCase(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Mirror of `toCamelCase` in `scripts/create-adapter.mjs`. Inline-duplicated
 * for the same reason as `toPascalCase` — if the scaffolder's helper drifts,
 * this check exercises the same logic and catches it.
 */
function toCamelCase(slug) {
  const parts = slug.split('-');
  return parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

// Tokens that MUST be substituted out of every output file. Mirrored from
// `scripts/create-adapter.mjs`. The 4-token set finalized in #698 — added
// `__camelName__` so hyphenated slugs produce valid TS identifiers.
const TOKENS = ['__name__', '__Name__', '__camelName__', '__BRAND__'];

const errors = [];

function fail(msg) {
  errors.push(msg);
}

async function listFilesRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  return out.sort();
}

/**
 * Mirrors the scaffolder's token substitution (see `create-adapter.mjs`
 * `applyTokens`). `__BRAND__` defaults to the same value as `__Name__` —
 * if the scaffolder ever decouples BRAND from Name, update both sides
 * together (this function + `create-adapter.mjs`'s tokens construction).
 */
function applyExpectedSubstitution(relPath, tokens) {
  return relPath
    .split('__name__').join(tokens.name)
    .split('__Name__').join(tokens.Name)
    .split('__camelName__').join(tokens.camelName)
    .split('__BRAND__').join(tokens.Name);
}

/**
 * Identifier-syntax check for the hyphenated-slug run (#698).
 *
 * Catches the bug class where `__name__` is mistakenly used in a TypeScript
 * identifier slot — for a hyphenated slug the substitution produces e.g.
 * `smoke-testAdapterManifest`, which TS parses as subtraction. This is
 * exactly what #698 surfaced.
 *
 * Heuristic patterns — each looks for a hyphen sitting between identifier
 * characters in a position where TS expects a single identifier. The set
 * is intentionally narrow to avoid false positives on legitimate hyphens
 * in strings (`'__name__.publicapi.v1'` → `'smoke-test.publicapi.v1'`),
 * package names (`@openlinker/integrations-smoke-test`), and file paths
 * inside import strings (`from './smoke-test-plugin'`).
 *
 * The CI `scaffold-smoke.yml` workflow runs `tsc -b` on the same output as
 * the authoritative compile check; this heuristic catches the bug class
 * at lint-time without spending the 15s+ a real build would cost.
 */
const IDENTIFIER_HYPHEN_PATTERNS = [
  // `export const <id-with-hyphen>:` or `= ...`
  /\bexport\s+const\s+([a-z][a-zA-Z0-9]*-[a-zA-Z][a-zA-Z0-9-]*)\b/,
  // Re-export list: `{ <id-with-hyphen>, ... }` — match a name inside
  // brace-delimited list followed by `,` or `}`. Excludes `from '...'`
  // string positions because those aren't followed by `,` or `}`.
  /[{,]\s*([a-z][a-zA-Z0-9]*-[a-zA-Z][a-zA-Z0-9-]*)\s*[,}]/,
  // Object literal value: `<key>: <id-with-hyphen>` followed by `,` or `}`
  /[a-zA-Z_$][a-zA-Z0-9_$]*\s*:\s*([a-z][a-zA-Z0-9]*-[a-zA-Z][a-zA-Z0-9-]*)\s*[,)}]/,
];

function checkHyphenatedIdentifierSyntax(absFile, contents, rel) {
  if (!absFile.endsWith('.ts')) return;
  // Strip line and block comments to avoid false positives on commented
  // examples that include hyphens. Strings are not stripped — the
  // assumption is that legitimate hyphenated strings (package names,
  // URLs, file paths in import specifiers) won't match the narrow
  // identifier-context patterns above.
  const stripped = contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const lines = stripped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of IDENTIFIER_HYPHEN_PATTERNS) {
      const m = lines[i].match(pattern);
      if (m) {
        fail(
          `check-create-adapter: hyphen in TypeScript identifier slot in ${rel}:${i + 1} — ` +
            `"${m[0].trim()}". Likely a __name__ token used where __camelName__ is required (#698).`,
        );
      }
    }
  }
}

/**
 * Run the full assertion suite once for a single slug.
 */
async function runScaffoldCheck(slug) {
  const tokens = {
    name: slug,
    Name: toPascalCase(slug),
    camelName: toCamelCase(slug),
  };

  // 1. Compute expected output file list by walking the templates dir
  //    and applying the same token substitution the scaffolder applies.
  const templateFiles = await listFilesRecursive(TEMPLATES_DIR);
  const expectedRelPaths = new Set(
    templateFiles.map((absPath) =>
      applyExpectedSubstitution(relative(TEMPLATES_DIR, absPath), tokens),
    ),
  );

  // 2. Scaffold into a unique tmp dir.
  const tmpRoot = await mkdtemp(join(tmpdir(), `openlinker-create-adapter-check-${slug}-`));
  let scaffoldResult;
  try {
    scaffoldResult = await scaffoldAdapter({
      name: slug,
      targetDir: tmpRoot,
    });

    // 3. Walk the scaffolded output and collect relative paths.
    const scaffoldedFiles = await listFilesRecursive(scaffoldResult.targetPkgDir);
    const actualRelPaths = new Set(
      scaffoldedFiles.map((abs) => relative(scaffoldResult.targetPkgDir, abs)),
    );

    // 4. Diff expected vs actual.
    for (const expected of expectedRelPaths) {
      if (!actualRelPaths.has(expected)) {
        fail(
          `check-create-adapter[${slug}]: expected file missing from scaffolder output: ${expected}`,
        );
      }
    }
    for (const actual of actualRelPaths) {
      if (!expectedRelPaths.has(actual)) {
        fail(
          `check-create-adapter[${slug}]: unexpected file in scaffolder output (not in templates dir): ${actual}`,
        );
      }
    }

    // 5. Count sanity check (per-run).
    if (actualRelPaths.size !== EXPECTED_FILE_COUNT) {
      fail(
        `check-create-adapter[${slug}]: file count mismatch — expected ${EXPECTED_FILE_COUNT}, got ${actualRelPaths.size} ` +
          `(bump EXPECTED_FILE_COUNT after verifying the scaffolder still works end to end)`,
      );
    }

    // 6. Token-leftover check on every output file.
    for (const absFile of scaffoldedFiles) {
      const rel = relative(scaffoldResult.targetPkgDir, absFile);
      const contents = await readFile(absFile, 'utf8');
      for (const token of TOKENS) {
        if (contents.includes(token)) {
          fail(
            `check-create-adapter[${slug}]: substitution token "${token}" leaked into output file: ${rel}`,
          );
        }
      }

      // 7. Identifier-syntax check — only on the hyphenated slug, where
      //    a stray `__name__` in an identifier slot surfaces as a `-`
      //    inside what TS expects to be a single identifier.
      if (slug.includes('-')) {
        checkHyphenatedIdentifierSyntax(absFile, contents, rel);
      }
    }
  } finally {
    // Best-effort cleanup. force:true tolerates partial-write states.
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function main() {
  for (const slug of SCAFFOLD_SLUGS) {
    await runScaffoldCheck(slug);
  }

  if (errors.length > 0) {
    for (const msg of errors) {
      process.stderr.write(`${msg}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `check-create-adapter: OK (${SCAFFOLD_SLUGS.length} slugs × ${EXPECTED_FILE_COUNT} files)\n`,
  );
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`check-create-adapter: unexpected error — ${message}\n`);
  process.exit(1);
}
