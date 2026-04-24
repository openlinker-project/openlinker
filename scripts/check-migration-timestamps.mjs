#!/usr/bin/env node
/**
 * Migration Timestamp Invariant Guard (#374)
 *
 * Scans `apps/api/src/migrations/` and fails on any violation of the
 * three rules that together prevent the ordering bug where two migrations
 * share a timestamp — TypeORM 0.3.17 sorts by timestamp alone with no
 * deterministic tie-breaker, so a collision can leave one `up()` body
 * silently unapplied while both class names appear in the `migrations`
 * table.
 *
 * Enforced invariants:
 *   1. Every migration filename begins with exactly 13 digits followed by
 *      `-` (e.g. `1790000000002-add-currency-to-products.ts`). This is the
 *      `.now()` millisecond shape TypeORM generates.
 *   2. The class exported from the file declares the same 13-digit suffix
 *      as the filename prefix (catches half-renames that update one side
 *      but not the other).
 *   3. No two migration files share the same 13-digit prefix.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain, so a
 * collision fails pre-commit and CI runs before the broken migration can
 * ever reach a shared environment.
 *
 * Exits non-zero on violation, with one human-readable line per problem.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = resolve(ROOT, 'apps/api/src/migrations');

const FILENAME_RE = /^(\d+)-(.+)\.ts$/;
const CANONICAL_TIMESTAMP_LEN = 13;
const CLASS_RE = /export\s+class\s+\w+?(\d+)\s+implements\s+MigrationInterface/;

/**
 * Pure validator. Takes an array of `{ filename, source }` entries and
 * returns `{ ok, violations }`. Kept free of I/O so the self-check at the
 * bottom of this file can drive it with inline fixtures.
 */
export function validateEntries(entries) {
  const violations = [];
  const byTimestamp = new Map();

  for (const { filename, source } of entries) {
    const match = FILENAME_RE.exec(filename);
    if (!match) {
      violations.push(`${filename}: filename does not match {timestamp}-{name}.ts`);
      continue;
    }

    const [, timestamp] = match;
    if (timestamp.length !== CANONICAL_TIMESTAMP_LEN) {
      violations.push(
        `${filename}: timestamp has ${timestamp.length} digits, expected ${CANONICAL_TIMESTAMP_LEN}`,
      );
      continue;
    }

    const classMatch = CLASS_RE.exec(source);
    if (!classMatch) {
      violations.push(
        `${filename}: could not find \`export class …${'${digits}'} implements MigrationInterface\``,
      );
    } else {
      const classTimestamp = classMatch[1];
      if (classTimestamp !== timestamp) {
        violations.push(
          `${filename}: filename timestamp ${timestamp} ≠ class timestamp ${classTimestamp}`,
        );
      }
    }

    const existing = byTimestamp.get(timestamp);
    if (existing) {
      violations.push(
        `${filename}: shares timestamp ${timestamp} with ${existing} (TypeORM ordering is undefined)`,
      );
    } else {
      byTimestamp.set(timestamp, filename);
    }
  }

  return { ok: violations.length === 0, violations };
}

function loadMigrationsFromDisk(dir) {
  const filenames = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  return filenames.map((filename) => ({
    filename,
    source: readFileSync(resolve(dir, filename), 'utf8'),
  }));
}

function runAgainstTree() {
  const entries = loadMigrationsFromDisk(MIGRATIONS_DIR);
  const { ok, violations } = validateEntries(entries);

  if (!ok) {
    for (const line of violations) {
      console.error(`migration-timestamps: ${line}`);
    }
    console.error(`migration-timestamps: ${violations.length} violation(s)`);
    process.exit(1);
  }

  console.log(`migration-timestamps: OK (${entries.length} migrations)`);
}

function runSelfCheck() {
  const fail = (label, entries, expectedSubstring) => {
    const { ok, violations } = validateEntries(entries);
    if (ok) {
      console.error(`self-check FAIL: "${label}" expected a violation, got none`);
      process.exit(1);
    }
    if (!violations.some((v) => v.includes(expectedSubstring))) {
      console.error(
        `self-check FAIL: "${label}" expected violation containing "${expectedSubstring}", got:\n  ${violations.join('\n  ')}`,
      );
      process.exit(1);
    }
  };

  const pass = (label, entries) => {
    const { ok, violations } = validateEntries(entries);
    if (!ok) {
      console.error(
        `self-check FAIL: "${label}" expected no violations, got:\n  ${violations.join('\n  ')}`,
      );
      process.exit(1);
    }
  };

  pass('happy path', [
    {
      filename: '1790000000000-a.ts',
      source: 'export class A1790000000000 implements MigrationInterface {}',
    },
    {
      filename: '1790000000001-b.ts',
      source: 'export class B1790000000001 implements MigrationInterface {}',
    },
  ]);

  fail(
    'duplicate timestamp',
    [
      {
        filename: '1790000000000-a.ts',
        source: 'export class A1790000000000 implements MigrationInterface {}',
      },
      {
        filename: '1790000000000-b.ts',
        source: 'export class B1790000000000 implements MigrationInterface {}',
      },
    ],
    'shares timestamp',
  );

  fail(
    'class/filename mismatch',
    [
      {
        filename: '1790000000002-a.ts',
        source: 'export class A1790000000000 implements MigrationInterface {}',
      },
    ],
    'class timestamp 1790000000000',
  );

  fail(
    'short timestamp',
    [
      {
        filename: '17900000-a.ts',
        source: 'export class A17900000 implements MigrationInterface {}',
      },
    ],
    'digits, expected 13',
  );

  console.log('migration-timestamps: self-check OK');
}

if (process.argv.includes('--self-check')) {
  runSelfCheck();
} else {
  runAgainstTree();
}
