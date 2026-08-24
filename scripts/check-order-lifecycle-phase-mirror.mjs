#!/usr/bin/env node
/**
 * check-order-lifecycle-phase-mirror.mjs
 *
 * Lint-time invariant for the three hand-maintained mirrors of the nine-value
 * derived order lifecycle phase vocabulary (#2305 / #2311, ADR-059).
 *
 * The authoritative declaration is `OrderLifecyclePhaseValues` in
 *   libs/core/src/order-lifecycle/domain/types/order-lifecycle-phase.types.ts
 * and **its array order IS the ordinal** — `ORDER_LIFECYCLE_PHASE_PRECEDENCE`
 * is computed from it, the pure derivation reads that ordinal, and the SQL
 * `CASE` is built by iterating the same array. Reordering the array therefore
 * changes behaviour; a reorder in a mirror is a hard failure here, never a nit.
 *
 * Two rules, deliberately of different strength.
 *
 * RULE A — value + order equality (core vs frontend).
 *   `apps/web/src/features/orders/lib/order-lifecycle-phase.ts` re-declares the
 *   same exported name because the browser bundle does not depend on
 *   `@openlinker/core`. A copy drifts silently in both directions: a phase added
 *   only to core never reaches the browser, and one added only to the FE
 *   type-checks against a value the API will never send.
 *
 * RULE B — STRUCTURAL only (core vs the repository SQL twin).
 *   `LIFECYCLE_PHASE_PREDICATES` in
 *   libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts
 *   is asserted to carry (i) exactly the core phases, (ii) in the same order,
 *   and (iii) to still be consumed by a `LIFECYCLE_PHASE_EXPR` built with
 *   `OrderLifecyclePhaseValues.map(` — so the `CASE` can never silently become a
 *   hand-written ladder that restates the precedence a fourth time.
 *
 *   **What this script must NEVER assert: that a phase's SQL predicate is
 *   semantically its TS derivation arm.** THREE arms are documented `FALSE`
 *   placeholders — `vendor_authoritative`, `held` and `amending` — kept in
 *   precedence position rather than deleted so the ladder reads top-to-bottom
 *   like the TS file. `FALSE` is the only honest twin while the facts they test
 *   have no persisted source. The `vendor_authoritative` case is the sharpest:
 *   the repository file's own NOTE FOR #2311 records that the corresponding TS
 *   arm is a declared-phase PASSTHROUGH returning ANY phase in the vocabulary
 *   (`vendorDeclaredPhase ?? 'vendor_authoritative'`), so reading `FALSE` as
 *   "this arm means `vendor_authoritative`" would be a false claim. A later
 *   reader must not "strengthen" rule B into one.
 *
 * All three files are parsed TEXTUALLY (no TypeScript import, no transpile) so
 * this script stays a zero-dependency `check:invariants` step like its siblings.
 * Line and block comments are stripped before comparison.
 *
 * Run with `--self-check` to exercise the pure parser + differ against synthetic
 * inputs (no filesystem), including deliberately drifted fixtures.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join(
  'libs',
  'core',
  'src',
  'order-lifecycle',
  'domain',
  'types',
  'order-lifecycle-phase.types.ts',
);
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'orders',
  'lib',
  'order-lifecycle-phase.ts',
);
const REPOSITORY_FILE = join(
  'libs',
  'core',
  'src',
  'orders',
  'infrastructure',
  'persistence',
  'repositories',
  'order-record.repository.ts',
);

/** The `as const` array this script treats as authoritative, by name. */
const PHASE_DECLARATION = 'OrderLifecyclePhaseValues';
/** The `Record<OrderLifecyclePhase, string>` whose keys mirror it. */
const PREDICATES_DECLARATION = 'LIFECYCLE_PHASE_PREDICATES';
/**
 * The literal substring proving the SQL `CASE` still IMPORTS the precedence
 * rather than restating it. See rule B above.
 */
const EXPR_CONSTRUCTION = `${PHASE_DECLARATION}.map(`;

const DOCS_REF = 'docs/architecture/adrs/059-order-lifecycle-derived-phase.md';

/** Strip line and block comments so an annotated entry can't be read as a value. */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line number the declaration starts on. Returns `{ line, values }`,
 * or `null` when the declaration is absent.
 */
export function parsePhaseValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = stripComments(content.slice(openBracket + 1, closeBracket));

  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) {
    values.push(m[1] ?? m[2]);
  }

  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, values };
}

/**
 * Mask everything that is not a depth-1 character of an object literal: nested
 * braces (a `Object.freeze({…})` value, a `${…}` template hole) and the contents
 * of every quoted or backticked string. Masked characters become spaces, so line
 * numbers and column offsets are preserved and a key regex can then run over the
 * whole body without misreading a nested key or a string fragment as a key.
 *
 * Returns `{ masked, endIndex }` where `endIndex` is the index of the closing
 * brace, or `null` when the literal is unbalanced.
 */
export function maskObjectBody(content, openBrace) {
  const chars = content.split('');
  const masked = new Array(chars.length).fill(' ');
  let depth = 0;

  /** Index just past the closing quote of the string opening at `start`. */
  const endOfString = (start) => {
    const quote = chars[start];
    for (let j = start + 1; j < chars.length; j += 1) {
      if (chars[j] === '\\') {
        j += 1;
        continue;
      }
      if (chars[j] === quote) return j + 1;
    }
    return chars.length;
  };

  for (let i = openBrace; i < chars.length; i += 1) {
    const ch = chars[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const end = endOfString(i);
      // A quoted KEY must survive masking; a quoted VALUE must not, or a string
      // body like `rec."cancelledAt" IS NOT NULL` could be misread as a key.
      // The two are told apart by what follows the closing quote.
      let k = end;
      while (k < chars.length && /\s/.test(chars[k])) k += 1;
      const isKey = depth === 1 && chars[k] === ':';
      if (isKey) {
        for (let j = i; j < end; j += 1) masked[j] = chars[j];
      }
      i = end - 1;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      if (depth === 1) masked[i] = ch;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { masked: masked.join(''), endIndex: i };
      continue;
    }

    if (depth === 1) masked[i] = ch;
  }

  return null;
}

/**
 * Ordered depth-1 keys of an object literal declared under `name`, plus the raw
 * source segment of each entry (used by sibling checks that need the entry's
 * own fields). Keys may be quoted or bare and may contain hyphens.
 *
 * Returns `{ line, keys, segments }` or `null` when the declaration is absent
 * or its literal is unbalanced.
 */
export function parseObjectKeys(content, name) {
  const declRe = new RegExp(`${name}\\s*(?::[^=]*)?=\\s*`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBrace = content.indexOf('{', declMatch.index + declMatch[0].length - 1);
  if (openBrace === -1) return null;

  const stripped = stripComments(content);
  // Comment stripping preserves neither offsets nor the declaration position, so
  // re-locate against the stripped source and mask from there.
  const strippedDecl = declRe.exec(stripped);
  if (!strippedDecl) return null;
  const strippedOpen = stripped.indexOf('{', strippedDecl.index + strippedDecl[0].length - 1);
  if (strippedOpen === -1) return null;

  const maskedResult = maskObjectBody(stripped, strippedOpen);
  if (!maskedResult) return null;

  const body = maskedResult.masked.slice(strippedOpen + 1, maskedResult.endIndex);

  const keys = [];
  const segments = [];
  const keyRe = /(?:^|[\s,])(?:'([a-z_-]+)'|"([a-z_-]+)"|([a-z_-]+))\s*:/gm;
  let m;
  const starts = [];
  while ((m = keyRe.exec(body)) !== null) {
    keys.push(m[1] ?? m[2] ?? m[3]);
    starts.push(m.index);
  }
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : body.length;
    segments.push(stripped.slice(strippedOpen + 1 + starts[i], strippedOpen + 1 + end));
  }

  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, keys, segments };
}

/**
 * Pure differ over two ordered vocabularies. Returns `{ ok, issues }`; each
 * issue is one human-readable asymmetric difference. Order is reported as a
 * failure because for this vocabulary the order IS the ordinal.
 */
export function diffPhaseValues(core, mirror, mirrorLabel) {
  const issues = [];

  const coreSet = new Set(core);
  const mirrorSet = new Set(mirror);

  const missingInMirror = core.filter((v) => !mirrorSet.has(v));
  const missingInCore = mirror.filter((v) => !coreSet.has(v));

  if (missingInMirror.length > 0) {
    issues.push(
      `present in core but MISSING from the ${mirrorLabel}: ${missingInMirror
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (missingInCore.length > 0) {
    issues.push(
      `present in the ${mirrorLabel} but MISSING from core: ${missingInCore
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (issues.length === 0 && core.join('|') !== mirror.join('|')) {
    issues.push(
      `same values but DIFFERENT ORDER, and the order is the precedence ordinal ` +
        `(core: ${core.join(', ')} / ${mirrorLabel}: ${mirror.join(', ')})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  const [coreContent, frontendContent, repositoryContent] = await Promise.all([
    readFile(join(repoRoot, CORE_FILE), 'utf8'),
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
    readFile(join(repoRoot, REPOSITORY_FILE), 'utf8'),
  ]);

  const fatal = [];
  const drifts = [];

  const core = parsePhaseValues(coreContent, PHASE_DECLARATION);
  if (!core || core.values.length === 0) {
    fatal.push(
      `${CORE_FILE}: no 'export const ${PHASE_DECLARATION} = [...]' with string literals found`,
    );
  }

  const frontend = parsePhaseValues(frontendContent, PHASE_DECLARATION);
  if (!frontend || frontend.values.length === 0) {
    fatal.push(
      `${FRONTEND_FILE}: no 'export const ${PHASE_DECLARATION} = [...]' with string literals found`,
    );
  }

  const predicates = parseObjectKeys(repositoryContent, PREDICATES_DECLARATION);
  if (!predicates || predicates.keys.length === 0) {
    fatal.push(`${REPOSITORY_FILE}: no '${PREDICATES_DECLARATION} = { … }' object literal found`);
  }

  if (fatal.length > 0) {
    console.error('✗ check-order-lifecycle-phase-mirror: could not locate every declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error(`\n  docs: ${DOCS_REF}\n`);
    process.exit(1);
  }

  // Rule A — value + order equality against the frontend mirror.
  const feDiff = diffPhaseValues(core.values, frontend.values, 'frontend mirror');
  if (!feDiff.ok) {
    drifts.push({
      rule: `A: ${PHASE_DECLARATION} must be identical, in the same order, in both files`,
      locations: [
        `${CORE_FILE}:${core.line}  (authoritative)`,
        `${FRONTEND_FILE}:${frontend.line}  (hand-maintained mirror)`,
      ],
      issues: feDiff.issues,
    });
  }

  // Rule B (i)+(ii) — the SQL arm SET and ORDER, never per-arm semantics.
  const sqlDiff = diffPhaseValues(core.values, predicates.keys, `SQL ${PREDICATES_DECLARATION}`);
  if (!sqlDiff.ok) {
    drifts.push({
      rule:
        `B: ${PREDICATES_DECLARATION} must carry exactly one arm per phase, in precedence ` +
        `order (arm SEMANTICS are deliberately NOT compared — three arms are 'FALSE' placeholders)`,
      locations: [
        `${CORE_FILE}:${core.line}  (authoritative)`,
        `${REPOSITORY_FILE}:${predicates.line}  (SQL twin)`,
      ],
      issues: sqlDiff.issues,
    });
  }

  // Rule B (iii) — the CASE still imports the precedence rather than restating it.
  if (!repositoryContent.includes(EXPR_CONSTRUCTION)) {
    drifts.push({
      rule: `B: the SQL CASE must still be built with '${EXPR_CONSTRUCTION}'`,
      locations: [`${REPOSITORY_FILE}  (SQL twin)`],
      issues: [
        `'${EXPR_CONSTRUCTION}' no longer appears in the file — the CASE may have become a ` +
          `hand-written ladder that restates the precedence a fourth time`,
      ],
    });
  }

  if (drifts.length === 0) {
    console.log(
      `✓ check-order-lifecycle-phase-mirror: ${core.values.length} phase(s) identical and in ` +
        `precedence order across ${CORE_FILE}, ${FRONTEND_FILE} and the SQL twin in ${REPOSITORY_FILE}.`,
    );
    process.exit(0);
  }

  console.error(`✗ check-order-lifecycle-phase-mirror: ${drifts.length} drifted mirror(s).\n`);
  for (const { rule, locations, issues } of drifts) {
    for (const location of locations) console.error(`    ${location}`);
    console.error(`      rule: ${rule}`);
    for (const issue of issues) console.error(`        - ${issue}`);
    console.error('');
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parser + differ against synthetic inputs (no filesystem). */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const name = PHASE_DECLARATION;
  const file = (declName, entries) =>
    `/** header */\nexport const ${declName} = [\n${entries}\n] as const;\n`;

  // --- parser: array literals -------------------------------------------------
  const parsed = parsePhaseValues(file(name, "  'cancelled',\n  'ready',"), name);
  expect('parses two literals', parsed?.values.join(','), 'cancelled,ready');
  expect('reports the declaration line', parsed?.line, 2);

  expect(
    'strips line comments',
    parsePhaseValues(file(name, "  'cancelled',\n  // 'ghost'\n  'ready',"), name)?.values.join(','),
    'cancelled,ready',
  );
  expect(
    'strips block comments',
    parsePhaseValues(file(name, "  'cancelled',\n  /* 'ghost' */\n  'ready',"), name)?.values.join(
      ',',
    ),
    'cancelled,ready',
  );
  expect(
    'selects the requested declaration, not the first one',
    parsePhaseValues(
      file('OtherValues', "  'other',") + file(name, "  'cancelled',"),
      name,
    )?.values.join(','),
    'cancelled',
  );
  expect('absent declaration → null', parsePhaseValues('export const X = 1;', name), null);
  expect(
    'declaration present but empty → zero values (a FATAL, never a pass)',
    parsePhaseValues(file(name, ''), name)?.values.length,
    0,
  );

  // --- parser: object keys (the SQL Record twin) ------------------------------
  const predicates =
    `  private static readonly ${PREDICATES_DECLARATION}: Record<OrderLifecyclePhase, string> = {\n` +
    `    // 1. a comment naming 'ghost'\n` +
    '    cancelled: `rec."cancelledAt" IS NOT NULL`,\n' +
    "    vendor_authoritative: 'FALSE',\n" +
    "    'in_transit': `${Repo.ROLLUP} = 'dispatched'`,\n" +
    "    ready: 'TRUE',\n" +
    '  };\n';
  const keys = parseObjectKeys(predicates, PREDICATES_DECLARATION);
  expect(
    'parses object keys, quoted and unquoted, ignoring comments and string bodies',
    keys?.keys.join(','),
    'cancelled,vendor_authoritative,in_transit,ready',
  );
  expect('reports the object declaration line', keys?.line, 1);
  expect(
    'absent object declaration → null',
    parseObjectKeys('const other = { a: 1 };', PREDICATES_DECLARATION),
    null,
  );

  // Nested object literals must not contribute keys (the authority-descriptor
  // shape; asserted here too because the parser is shared in spirit).
  const nested =
    `const ${PREDICATES_DECLARATION} = Object.freeze({\n` +
    "  availability: Object.freeze({ capability: 'A', configKey: 'b' }),\n" +
    "  'fulfillment-execution': Object.freeze({ capability: 'C', configKey: 'd' }),\n" +
    '});\n';
  expect(
    'nested literal depth is respected; hyphenated quoted keys survive',
    parseObjectKeys(nested, PREDICATES_DECLARATION)?.keys.join(','),
    'availability,fulfillment-execution',
  );

  // --- differ: agreement and every drift shape --------------------------------
  const nine = ['cancelled', 'vendor_authoritative', 'delivered', 'ready'];
  expect('identical → ok', diffPhaseValues(nine, [...nine], 'm').ok, true);

  // Deliberately drifted fixtures: each MUST fail.
  const dropped = nine.filter((v) => v !== 'delivered');
  expect('value removed from the mirror → not ok', diffPhaseValues(nine, dropped, 'm').ok, false);
  expect('value added to the mirror → not ok', diffPhaseValues(dropped, nine, 'm').ok, false);

  const reordered = ['vendor_authoritative', 'cancelled', 'delivered', 'ready'];
  expect('reordered precedence → not ok', diffPhaseValues(nine, reordered, 'm').ok, false);
  expect(
    'reorder is reported as a precedence-ordinal failure',
    diffPhaseValues(nine, reordered, 'm').issues[0].includes('DIFFERENT ORDER'),
    true,
  );
  expect(
    'a removed SQL arm is reported by the same differ',
    diffPhaseValues(nine, nine.slice(0, 3), `SQL ${PREDICATES_DECLARATION}`).ok,
    false,
  );

  // --- rule B (iii): the structural construction assert ----------------------
  expect(
    'the .map( construction assert fires when the CASE is hand-written',
    "const EXPR = `CASE WHEN a THEN 'cancelled' END`;".includes(EXPR_CONSTRUCTION),
    false,
  );
  expect(
    'the .map( construction assert passes on the real shape',
    `const EXPR = \`CASE \${${EXPR_CONSTRUCTION}(p) => p).join(' ')} END\`;`.includes(
      EXPR_CONSTRUCTION,
    ),
    true,
  );

  if (failures.length > 0) {
    console.error('✗ check-order-lifecycle-phase-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-order-lifecycle-phase-mirror --self-check: parser + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  // Explicit fatal handler, matching the sibling mirror checks. A bare top-level
  // `await main()` surfaces a rename of any mirrored file as a raw
  // unhandled-rejection stack instead of one actionable line.
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-order-lifecycle-phase-mirror: fatal error:', err);
    process.exit(1);
  });
}
