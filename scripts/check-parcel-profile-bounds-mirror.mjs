#!/usr/bin/env node
/**
 * check-parcel-profile-bounds-mirror.mjs
 *
 * Lint-time invariant for the browser's copy of the routing-rule parcel-profile
 * ceilings (#3652 review).
 *
 * Rule. The API refuses a parcel profile above `PARCEL_PROFILE_BOUNDS` (the
 * DTO's `@Max` / `@MaxLength` read it) with a 400. The browser cannot import
 * `@openlinker/core` (#591), so the dialog re-declares the ceilings to refuse
 * in its own words — and it declares them in OPERATOR units:
 *
 *   PARCEL_PROFILE_BOUNDS  (libs/core/src/mappings/domain/types/fulfillment-routing.types.ts)  mm / g
 *   PARCEL_PROFILE_LIMITS  (apps/web/src/features/mappings/lib/parcel-profile.ts)              cm / kg
 *
 * The unit change is why this guard exists: a human comparing `5000` with
 * `500` has to remember the x10, and anyone raising a server bound has no
 * reason to look in apps/web at all. Each pair must be EQUAL after conversion,
 * not merely <=: the dialog's copy states the number to the operator, so a
 * lower browser ceiling would refuse a value the server accepts and quote the
 * wrong limit, and a higher one lets the 400 through.
 *
 *   dimensionCmMax    x 10    == dimensionMmMax
 *   weightKgMax       x 1000  == defaultWeightGramsMax
 *   templateMaxLength x 1     == parcelTemplateMaxLength
 *
 * AWAITING ITS SIBLING, not abandoned: `PARCEL_PROFILE_BOUNDS` arrives with
 * #3661 (#3651), so until that is on main this script cannot pass and is NOT
 * in `check:invariants`. When #3661 has merged, the change that updates #3662
 * to main also adds both invocations to `check:invariants`, before #3662
 * merges (#3662's description, "Merge order").
 *
 * SCOPE — what this does NOT catch:
 *   1. Floors. The server's `*Min` bounds are not mirrored as constants; the
 *      dialog's "greater than zero" rule is checked in wire units directly.
 *   2. Whether the dialog USES its constants, or the DTO uses the server's —
 *      only the literals are compared. The unit specs on both sides own that.
 *   3. The conversion factors are physics (1 cm = 10 mm, 1 kg = 1000 g) and are
 *      hardcoded here rather than read from the browser module, so a broken
 *      conversion in the browser cannot make this check agree with itself.
 *
 * Both files are parsed TEXTUALLY (comments stripped, then `key: <integer>`
 * pairs read from the object literal) so this stays a zero-dependency
 * `check:invariants` step. A missing declaration or a missing key on either
 * side is a FAILURE, never a pass — a gate that matched nothing would pass
 * forever.
 *
 * Usage:
 *   node scripts/check-parcel-profile-bounds-mirror.mjs
 *   node scripts/check-parcel-profile-bounds-mirror.mjs --self-check
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const BACKEND_FILE = 'libs/core/src/mappings/domain/types/fulfillment-routing.types.ts';
const BACKEND_DECLARATION = 'PARCEL_PROFILE_BOUNDS';
const FRONTEND_FILE = 'apps/web/src/features/mappings/lib/parcel-profile.ts';
const FRONTEND_DECLARATION = 'PARCEL_PROFILE_LIMITS';

/** [frontend key, factor to wire units, backend key, wire unit] */
const PAIRS = [
  ['dimensionCmMax', 10, 'dimensionMmMax', 'mm'],
  ['weightKgMax', 1000, 'defaultWeightGramsMax', 'g'],
  ['templateMaxLength', 1, 'parcelTemplateMaxLength', 'characters'],
];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Read `export const <name> = { key: <int>, ... }` into a plain object of
 * integers. Null when the declaration is absent. Non-integer values are
 * skipped, so a key turned into an expression surfaces as "missing key".
 */
export function readIntObject(source, name) {
  const stripped = stripComments(source);
  const decl = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\{`).exec(stripped);
  if (!decl) return null;
  const open = decl.index + decl[0].length;
  const close = stripped.indexOf('}', open);
  if (close === -1) return null;
  const body = stripped.slice(open, close);
  const values = {};
  const pairRe = /([A-Za-z_$][\w$]*)\s*:\s*(\d[\d_]*)\s*(?=,|$)/g;
  let m;
  while ((m = pairRe.exec(body)) !== null) values[m[1]] = Number(m[2].replace(/_/g, ''));
  return values;
}

/** Problems comparing the two objects; empty when every pair agrees. */
export function comparePairs(frontend, backend) {
  const problems = [];
  for (const [feKey, factor, beKey, unit] of PAIRS) {
    const fe = frontend[feKey];
    const be = backend[beKey];
    if (fe === undefined)
      problems.push(`${FRONTEND_DECLARATION}.${feKey} is missing or not an integer literal`);
    if (be === undefined)
      problems.push(`${BACKEND_DECLARATION}.${beKey} is missing or not an integer literal`);
    if (fe === undefined || be === undefined) continue;
    if (fe * factor !== be) {
      problems.push(
        `${FRONTEND_DECLARATION}.${feKey} = ${fe} is ${fe * factor} ${unit} on the wire, but ` +
          `${BACKEND_DECLARATION}.${beKey} = ${be} ${unit}` +
          (factor === 1 ? '' : ` (expected ${feKey} = ${be / factor})`)
      );
    }
  }
  return problems;
}

function selfCheck() {
  const failures = [];
  const expect = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
  };

  expect(
    'reads an object literal with a trailing comma and `as const`',
    readIntObject('export const B = {\n  a: 1,\n  b: 100_000,\n} as const;', 'B'),
    { a: 1, b: 100000 }
  );
  expect(
    'ignores commented-out keys',
    readIntObject('export const B = { a: 1, // b: 2,\n /* c: 3, */ d: 4 };', 'B'),
    { a: 1, d: 4 }
  );
  expect('skips a non-literal value', readIntObject('export const B = { a: 1 * 10, b: 2 };', 'B'), {
    b: 2,
  });
  expect('reports an absent declaration', readIntObject('export const C = { a: 1 };', 'B'), null);

  const backend = {
    dimensionMmMax: 5000,
    defaultWeightGramsMax: 100000,
    parcelTemplateMaxLength: 32,
  };
  const frontend = { dimensionCmMax: 500, weightKgMax: 100, templateMaxLength: 32 };
  expect('agrees across the unit conversion', comparePairs(frontend, backend), []);
  expect(
    'detects a server bound raised alone',
    comparePairs(frontend, { ...backend, dimensionMmMax: 6000 }).length,
    1
  );
  // The trap the guard exists for: the browser value equals the server NUMBER
  // but not the server QUANTITY.
  expect(
    'detects a value copied without converting units',
    comparePairs({ ...frontend, weightKgMax: 100000 }, backend).length,
    1
  );
  expect(
    'detects a missing key',
    comparePairs({ dimensionCmMax: 500, weightKgMax: 100 }, backend).length,
    1
  );
  expect('fails when both sides are empty', comparePairs({}, {}).length, 6);

  if (failures.length > 0) {
    console.error('check-parcel-profile-bounds-mirror --self-check FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-parcel-profile-bounds-mirror --self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const problems = [];
  const parsed = {};
  for (const [label, file, name] of [
    ['frontend', FRONTEND_FILE, FRONTEND_DECLARATION],
    ['backend', BACKEND_FILE, BACKEND_DECLARATION],
  ]) {
    let source;
    try {
      source = await readFile(join(repoRoot, file), 'utf8');
    } catch {
      problems.push(`${file} could not be read — did the file move?`);
      continue;
    }
    const values = readIntObject(source, name);
    if (values === null) {
      problems.push(`${file} declares no \`export const ${name} = { ... }\``);
      continue;
    }
    parsed[label] = values;
  }

  if (problems.length === 0) problems.push(...comparePairs(parsed.frontend, parsed.backend));

  if (problems.length > 0) {
    console.error('check-parcel-profile-bounds-mirror FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n  server:  ${BACKEND_FILE}  (${BACKEND_DECLARATION}, mm / g)`);
    console.error(`  browser: ${FRONTEND_FILE}  (${FRONTEND_DECLARATION}, cm / kg)`);
    process.exit(1);
  }

  console.log(`check-parcel-profile-bounds-mirror OK (${PAIRS.length} bounds agree across units)`);
}

await main();
