#!/usr/bin/env node
/**
 * check-subiekt-capability-parity.mjs
 *
 * Lint-time invariant: an invoicing sub-capability that Subiekt GT declares and
 * Subiekt nexo does not must be a WRITTEN DOWN decision, never an oversight.
 *
 * The two packages are separate products reached through separate bridges, so
 * they are NOT required to declare the same set - `check-subiekt-identity-mirror`
 * exists precisely to keep them apart, and a naive "the sets must be equal" rule
 * here would be false on its face. What this guard refuses is the third state:
 * GT grows a sub-capability in a shared surface, nexo is never considered, and
 * the gap is discovered by a reviewer months later (#3398 shipped three of them
 * at once - `RegulatoryRecordLocator`, `PaymentStatusReader` and
 * `uniqueConfigKeys` - every one an accident rather than a choice).
 *
 * Nothing else catches it:
 *
 *   - `tsc` is happy: an adapter is free to implement fewer interfaces;
 *   - no test fails: each package's specs assert its OWN surface, so a gap is
 *     simply untested rather than red;
 *   - at runtime the capability is resolved by narrowing with an `is*` guard,
 *     which answers `false` and degrades silently - which is CORRECT behaviour
 *     and therefore indistinguishable from a deliberate absence.
 *
 * So the absence has to be declared. `NEXO_DELIBERATE_OMISSIONS` below is that
 * declaration: a sub-capability listed there is allowed to be missing and the
 * reason travels with it. Adding an entry is a one-line, reviewable act; NOT
 * adding one fails the build.
 *
 * Parsed TEXTUALLY so this stays a zero-dependency `check:invariants` step like
 * its siblings. Run with `--self-check` to exercise the parsers and the differ.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const GT_ADAPTER = 'libs/integrations/subiekt/src/infrastructure/adapters/subiekt-invoicing.adapter.ts';
const NEXO_ADAPTER =
  'libs/integrations/subiekt-nexo/src/infrastructure/adapters/subiekt-invoicing.adapter.ts';
const GT_MANIFEST = 'libs/integrations/subiekt/src/subiekt-plugin.ts';
const NEXO_MANIFEST = 'libs/integrations/subiekt-nexo/src/subiekt-plugin.ts';

/**
 * Sub-capabilities Subiekt GT declares that Subiekt nexo deliberately does not.
 * The value is the reason, printed when somebody asks why - so the next reader
 * gets an answer instead of a puzzle.
 *
 * An entry here is a CLAIM about the nexo bridge, not a TODO. Remove it the day
 * the bridge can serve the capability; do not add one to silence the check.
 */
export const NEXO_DELIBERATE_OMISSIONS = {
  PaymentStatusReader:
    'Subiekt nexo exposes no settlement/paid concept through the Sfera or SQL layer the ' +
    'bridge reads (GT reads the GT-schema column `dok_Rozliczony`, which has no Moria ' +
    'counterpart). An implementation could only ever report every document as unpaid - a ' +
    'confident false answer, which is worse than the capability being absent.',
};

/**
 * Manifest fields that are a property of HOW a bridge is addressed rather than
 * of which product is behind it, so both packages must carry them. `uniqueConfigKeys`
 * qualifies: it exists because two connections pointed at one bridge process share
 * that process's queue, which is equally true of either product.
 *
 * Deliberately NOT `defaultRateLimit` - GT pins `maxConcurrent: 1` for its
 * single-threaded STA COM queue and nexo runs 4, a real product difference.
 */
export const SHARED_MANIFEST_FIELDS = ['uniqueConfigKeys'];

/** Strip comments so prose naming a capability is never read as a declaration. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Read the `implements A, B, C {` clause of `export class <name>`.
 *
 * Returns `null` when the class or its clause cannot be found, which the caller
 * reports as a hard error rather than as an empty set - an unparsed clause must
 * never read as "this adapter declares nothing", which would make every GT
 * capability look like an undeclared nexo gap and, worse, make a nexo class
 * whose clause moved read as fully compliant.
 */
export function parseImplementsClause(source, className) {
  const clean = stripComments(source);
  const at = clean.indexOf(`class ${className}`);
  if (at === -1) return null;
  const implementsAt = clean.indexOf('implements', at);
  if (implementsAt === -1) return null;
  const open = clean.indexOf('{', implementsAt);
  if (open === -1) return null;
  return clean
    .slice(implementsAt + 'implements'.length, open)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** True when `field` is declared as an object key in the source. */
export function declaresField(source, field) {
  return new RegExp(`(?:^|[\\s{,])${field}\\s*:`, 'm').test(stripComments(source));
}

/**
 * Compare the two declared sets. Returns violation strings.
 *
 * Two directions, and only one of them is about GT:
 *   - GT declares X, nexo does not, and X is not in the omissions table -> a
 *     silent gap, the #3398 defect;
 *   - the omissions table names X, but nexo declares it anyway -> the table is
 *     lying about the code and its reason is now misinformation.
 */
export function diffCapabilities(gt, nexo, omissions) {
  const violations = [];
  const nexoSet = new Set(nexo);

  for (const capability of gt) {
    if (nexoSet.has(capability)) continue;
    if (Object.prototype.hasOwnProperty.call(omissions, capability)) continue;
    violations.push(
      `Subiekt GT declares '${capability}' and Subiekt nexo does not, with no recorded reason. ` +
        `Either implement it in the nexo package, or add it to NEXO_DELIBERATE_OMISSIONS ` +
        `with the reason the nexo bridge cannot serve it.`
    );
  }

  for (const [capability, reason] of Object.entries(omissions)) {
    if (nexoSet.has(capability)) {
      violations.push(
        `NEXO_DELIBERATE_OMISSIONS claims Subiekt nexo does not declare '${capability}', ` +
          `but it does. Remove the entry - its stated reason ("${reason.slice(0, 60)}...") is now false.`
      );
    }
  }

  return violations;
}

async function read(relativePath) {
  return readFile(join(ROOT, relativePath), 'utf8');
}

async function main() {
  const [gtAdapter, nexoAdapter, gtManifest, nexoManifest] = await Promise.all([
    read(GT_ADAPTER),
    read(NEXO_ADAPTER),
    read(GT_MANIFEST),
    read(NEXO_MANIFEST),
  ]);

  const gt = parseImplementsClause(gtAdapter, 'SubiektInvoicingAdapter');
  const nexo = parseImplementsClause(nexoAdapter, 'SubiektInvoicingAdapter');

  // Floored at zero as well as null-checked, and the two are different faults.
  // `parseImplementsClause` answers `null` when it cannot find the class or the
  // keyword, but a clause it DOES find whose members it cannot read answers `[]`
  // - and `[] !== null`, so a null-only guard passes, `diffCapabilities([], [])`
  // reports nothing, and the run prints OK having compared zero capabilities.
  // That is reachable by ordinary refactors: moving the interface list onto a
  // base class or a type alias, or commenting the members out while leaving the
  // keyword. Those are exactly when this guard should be loudest, so an empty
  // parse is a PARSER failure here and never "the adapter legitimately
  // implements nothing" - an adapter that implements nothing would not be one.
  // The #3002 `check-permission-mirror.mjs` precedent floors both sides the same
  // way and for the same stated reason.
  const unreadable = [
    gt === null ? `${GT_ADAPTER} (no class or no \`implements\` keyword)` : null,
    gt !== null && gt.length === 0 ? `${GT_ADAPTER} (clause found, no members read)` : null,
    nexo === null ? `${NEXO_ADAPTER} (no class or no \`implements\` keyword)` : null,
    nexo !== null && nexo.length === 0 ? `${NEXO_ADAPTER} (clause found, no members read)` : null,
  ].filter((entry) => entry !== null);

  if (unreadable.length > 0) {
    console.error(
      'check-subiekt-capability-parity: could not read an `implements` clause from ' +
        `${unreadable.join(' and ')}. That clause is what this invariant compares, so the ` +
        'check fails closed rather than passing on an empty set. An empty parse means the ' +
        'PARSER stopped working, not that the adapter stopped implementing anything.'
    );
    process.exit(1);
  }

  const violations = diffCapabilities(gt, nexo, NEXO_DELIBERATE_OMISSIONS);

  for (const field of SHARED_MANIFEST_FIELDS) {
    const inGt = declaresField(gtManifest, field);
    const inNexo = declaresField(nexoManifest, field);
    if (inGt && !inNexo) {
      violations.push(
        `${GT_MANIFEST} declares '${field}' and ${NEXO_MANIFEST} does not. This field is a ` +
          `property of how a bridge is addressed, not of which product is behind it, so both ` +
          `packages need it.`
      );
    }
  }

  if (violations.length > 0) {
    console.error('check-subiekt-capability-parity: FAILED');
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }

  const omitted = Object.keys(NEXO_DELIBERATE_OMISSIONS);
  console.log(
    `check-subiekt-capability-parity: OK (GT ${gt.length}, nexo ${nexo.length}` +
      `${omitted.length > 0 ? `, deliberately omitted: ${omitted.join(', ')}` : ''})`
  );
}

function selfCheck() {
  const assertions = [];
  const assert = (condition, label) => {
    assertions.push(label);
    if (!condition) {
      console.error(`check-subiekt-capability-parity --self-check FAILED: ${label}`);
      process.exit(1);
    }
  };

  const sample = `export class Foo\n  implements\n    A,\n    B,\n    C\n{\n  x = 1;\n}`;
  assert(
    JSON.stringify(parseImplementsClause(sample, 'Foo')) === JSON.stringify(['A', 'B', 'C']),
    'reads a multi-line implements clause'
  );
  assert(
    JSON.stringify(parseImplementsClause(`class Foo implements A {}`, 'Foo')) ===
      JSON.stringify(['A']),
    'reads a single-line implements clause'
  );
  assert(parseImplementsClause(`class Bar implements A {}`, 'Foo') === null, 'unknown class is null');
  assert(parseImplementsClause(`class Foo {}`, 'Foo') === null, 'a class with no clause is null');
  // The case the guard above exists for, and the one this self-check did not
  // cover before: a clause that IS found and yields no members. It must be
  // distinguishable from `null`, because the runner treats both as fatal but
  // reports them differently, and it must never be mistaken for a valid answer.
  assert(
    Array.isArray(parseImplementsClause(`class Foo implements {}`, 'Foo')),
    'a found-but-empty clause parses to an array, not null'
  );
  assert(
    parseImplementsClause(`class Foo implements {}`, 'Foo').length === 0,
    'a found-but-empty clause parses to an EMPTY array'
  );
  assert(
    diffCapabilities([], [], {}).length === 0,
    'the differ reports nothing for two empty sets, which is why the runner must floor them'
  );
  assert(
    parseImplementsClause(`/* implements Ghost { */\nclass Foo implements A {}`, 'Foo')[0] === 'A',
    'a clause quoted in a comment is not read'
  );
  assert(
    diffCapabilities(['A', 'B'], ['A', 'B'], {}).length === 0,
    'identical sets produce no violation'
  );
  assert(
    diffCapabilities(['A', 'B'], ['A'], {}).length === 1,
    'a GT capability missing from nexo with no reason is a violation'
  );
  assert(
    diffCapabilities(['A', 'B'], ['A'], { B: 'because' }).length === 0,
    'a declared omission is allowed'
  );
  assert(
    diffCapabilities(['A', 'B'], ['A', 'B'], { B: 'because' }).length === 1,
    'an omission entry for something nexo DOES declare is reported as a stale claim'
  );
  assert(
    diffCapabilities(['A'], ['A', 'Z'], {}).length === 0,
    'a nexo-only capability is not a violation - the products may legitimately diverge that way'
  );
  assert(declaresField(`{ uniqueConfigKeys: ['x'] }`, 'uniqueConfigKeys'), 'reads a declared field');
  assert(
    !declaresField(`// uniqueConfigKeys: ['x']`, 'uniqueConfigKeys'),
    'a commented-out field does not count as declared'
  );
  assert(
    !declaresField(`{ notUniqueConfigKeys: ['x'] }`, 'uniqueConfigKeys'),
    'does not match a longer identifier ending in the field name'
  );

  console.log(
    `check-subiekt-capability-parity --self-check passed (${assertions.length} assertions)`
  );
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  if (process.argv.includes('--self-check')) {
    selfCheck();
  } else {
    main().catch((error) => {
      console.error(`check-subiekt-capability-parity: ${error.message}`);
      process.exit(1);
    });
  }
}
