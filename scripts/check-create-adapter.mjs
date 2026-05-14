#!/usr/bin/env node
/**
 * Adapter Scaffolder Output Drift Guard (#684, partial)
 *
 * Imports the exported `scaffoldAdapter` from `scripts/create-adapter.mjs`,
 * scaffolds into `os.tmpdir()`, and asserts:
 *
 *   1. The set of files produced equals the expected substituted-name set
 *      derived from `scripts/create-adapter-templates/` (no missing, no
 *      unexpected).
 *   2. Every output file is clean of the three substitution tokens
 *      (`__name__`, `__Name__`, `__BRAND__`) — catches forgotten-spot bugs.
 *   3. The expected file count (constant `EXPECTED_FILE_COUNT`) matches the
 *      actual output count — catches "template added but invariant not
 *      bumped" drift.
 *
 * Out of scope (tracked separately as a follow-up to #684): full
 * `tsc --noEmit` smoke on the scaffolded output. Pre-commit budget for
 * existing invariants is sub-second; the install + tsc dance would push
 * that to ~15s, which is the wrong trade for catching the rare core-API-
 * rename drift class. The shape check here catches the common drift
 * (token substitution, file-shape changes).
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

const SCAFFOLD_NAME = 'lintcheck';

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

const SCAFFOLD_NAME_PASCAL = toPascalCase(SCAFFOLD_NAME);

// Tokens that MUST be substituted out of every output file. Mirrored from
// `scripts/create-adapter.mjs`. The 3-token set was finalized in #685 —
// `__NAME__` was dropped during tech-review there.
const TOKENS = ['__name__', '__Name__', '__BRAND__'];

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
    .split('__BRAND__').join(tokens.Name);
}

async function main() {
  // 1. Compute expected output file list by walking the templates dir
  //    and applying the same token substitution the scaffolder applies.
  const templateFiles = await listFilesRecursive(TEMPLATES_DIR);
  const expectedRelPaths = new Set(
    templateFiles.map((absPath) =>
      applyExpectedSubstitution(
        relative(TEMPLATES_DIR, absPath),
        { name: SCAFFOLD_NAME, Name: SCAFFOLD_NAME_PASCAL },
      ),
    ),
  );

  // 2. Scaffold into a unique tmp dir.
  const tmpRoot = await mkdtemp(join(tmpdir(), 'openlinker-create-adapter-check-'));
  let scaffoldResult;
  try {
    scaffoldResult = await scaffoldAdapter({
      name: SCAFFOLD_NAME,
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
          `check-create-adapter: expected file missing from scaffolder output: ${expected}`,
        );
      }
    }
    for (const actual of actualRelPaths) {
      if (!expectedRelPaths.has(actual)) {
        fail(
          `check-create-adapter: unexpected file in scaffolder output (not in templates dir): ${actual}`,
        );
      }
    }

    // 5. Count sanity check.
    if (actualRelPaths.size !== EXPECTED_FILE_COUNT) {
      fail(
        `check-create-adapter: file count mismatch — expected ${EXPECTED_FILE_COUNT}, got ${actualRelPaths.size} ` +
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
            `check-create-adapter: substitution token "${token}" leaked into output file: ${rel}`,
          );
        }
      }
    }
  } finally {
    // Best-effort cleanup. force:true tolerates partial-write states.
    await rm(tmpRoot, { recursive: true, force: true });
  }

  if (errors.length > 0) {
    for (const msg of errors) {
      process.stderr.write(`${msg}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `check-create-adapter: OK (${EXPECTED_FILE_COUNT} files)\n`,
  );
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`check-create-adapter: unexpected error — ${message}\n`);
  process.exit(1);
}
