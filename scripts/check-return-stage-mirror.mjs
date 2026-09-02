#!/usr/bin/env node
/**
 * check-return-stage-mirror.mjs
 *
 * Lint-time invariant for the two hand-maintained mirrors of the six-value
 * derived RETURN STAGE vocabulary (#2377, returns spec § 3.2).
 *
 * The authoritative declaration is `ReturnStageValues` in
 *   libs/core/src/returns/domain/types/return-stage.types.ts
 * and **its array order IS the ordinal** — first match wins, and the SQL `CASE`
 * is built by iterating the same array. Reordering therefore CHANGES BEHAVIOUR;
 * a reorder in a mirror is a hard failure here, never a nit.
 *
 * The stage is a PRESENTATION PROJECTION and never a persisted column. If a
 * future wave wants to persist it, that is a model change needing its own ADR —
 * this script must not be read as licence to add one.
 *
 * Two rules, deliberately of different strength.
 *
 * RULE A — value + order equality (core vs frontend).
 *   `apps/web/src/features/returns/lib/return-stage.types.ts` re-declares the
 *   vocabulary because the browser bundle does not depend on `@openlinker/core`.
 *   A copy drifts silently in both directions: a stage added only to core never
 *   reaches the browser, and one added only to the frontend type-checks against
 *   a value the API will never send. Note the two declarations use DIFFERENT
 *   NAMES — `ReturnStageValues` in core, `RETURN_STAGE_VALUES` in the browser,
 *   each following its own side's convention — so the names are parameters here
 *   rather than one shared constant.
 *
 * RULE B — STRUCTURAL only (core vs the repository SQL twin).
 *   `RETURN_STAGE_PREDICATES` in
 *   libs/core/src/returns/infrastructure/persistence/repositories/return.repository.ts
 *   is asserted to carry (i) exactly the core stages, (ii) in the same order,
 *   and (iii) to still be consumed by a `RETURN_STAGE_EXPR` built with
 *   `ReturnStageValues.map(` — so the `CASE` can never silently become a
 *   hand-written ladder restating the precedence a third time.
 *
 *   **What this script must NEVER assert: that a stage's SQL predicate is
 *   semantically its TS derivation arm.** The temptation here is sharper than in
 *   the order-lifecycle original, which justifies its structural limit by
 *   pointing at three documented `FALSE` placeholder arms. Every return-stage arm
 *   IS semantically real, so a later reader will notice the missing placeholders
 *   and conclude a semantic comparison is now achievable. It is not: the two
 *   sides are a TS function over numbers and a SQL `CASE` over aggregate
 *   columns — different languages over different shapes — and textual equality
 *   between them is impossible, which is also why the
 *   `check-shipping-tax-split-mirror` technique (`normalizeCode` + string
 *   equality over two TS functions) is the wrong tool despite being the closer
 *   shape precedent. A script attempting it would either never pass or be
 *   weakened into meaninglessness.
 *
 *   **Semantics are proved by `RETURN_STAGE_FIXTURES`** — one shared table which
 *   the core unit spec runs through `deriveReturnStage` and the integration spec
 *   inserts and reads back through `countReturnsByStage`. That is where "SQL and
 *   TS agree" is actually established; this script only guarantees they are
 *   still talking about the same six things in the same order.
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
  'returns',
  'domain',
  'types',
  'return-stage.types.ts',
);
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'returns',
  'lib',
  'return-stage.types.ts',
);
const REPOSITORY_FILE = join(
  'libs',
  'core',
  'src',
  'returns',
  'infrastructure',
  'persistence',
  'repositories',
  'return.repository.ts',
);

/** The `as const` array this script treats as authoritative, by name. */
const CORE_DECLARATION = 'ReturnStageValues';
/** The browser mirror's own name for the same vocabulary. */
const FRONTEND_DECLARATION = 'RETURN_STAGE_VALUES';
/** The `Record<ReturnStage, string>` whose keys mirror it. */
const PREDICATES_DECLARATION = 'RETURN_STAGE_PREDICATES';
/**
 * The literal substring proving the SQL `CASE` still IMPORTS the precedence
 * rather than restating it. See rule B above.
 */
const EXPR_CONSTRUCTION = `${CORE_DECLARATION}.map(`;

const DOCS_REF = 'docs/specs/product-spec-oms-returns-operator-ux.md § 3.2';

/**
 * Strip line and block comments so an annotated entry can't be read as a value.
 *
 * **Documented assumption (#2441 review S8):** this is a textual pass with no
 * string-literal awareness, so a `//` or `/*` appearing INSIDE a string literal
 * (a URL in a docstring, an SQL comment inside a predicate) would delete real
 * source and, in `parseObjectKeys`, shift the mask offsets. Both inputs are
 * repo-owned declarations — an `as const` array of bare phase names and a
 * `Record<…, string>` of SQL predicates — and neither contains such a sequence,
 * which is why the simple pass is adequate. A self-check fixture below pins the
 * boundary so the limit is a known one rather than a discovered one; if a
 * predicate ever needs an inline `--`-style comment or a `//`-bearing literal,
 * this function must become quote-aware first.
 */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line number the declaration starts on. Returns `{ line, values }`,
 * or `null` when the declaration is absent.
 */
export function parseStageValues(content, name) {
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
  // #2441 review S7 — `[A-Za-z0-9_-]`, not `[a-z_-]`. The narrow class silently
  // SKIPPED a camelCase or digit-bearing key (`vendorAuthoritative:`, `sla2:`),
  // and the differ would then report it as "MISSING from the SQL twin" — a loud
  // failure with a misleading message, which is the worst combination: the gate
  // fires but sends the reader after the wrong file. Collecting the key means
  // the diff describes the real asymmetry instead.
  const keyRe = /(?:^|[\s,])(?:'([A-Za-z0-9_-]+)'|"([A-Za-z0-9_-]+)"|([A-Za-z0-9_-]+))\s*:/gm;
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
export function diffStageValues(core, mirror, mirrorLabel) {
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

  const core = parseStageValues(coreContent, CORE_DECLARATION);
  if (!core || core.values.length === 0) {
    fatal.push(
      `${CORE_FILE}: no 'export const ${CORE_DECLARATION} = [...]' with string literals found`,
    );
  }

  const frontend = parseStageValues(frontendContent, FRONTEND_DECLARATION);
  if (!frontend || frontend.values.length === 0) {
    fatal.push(
      `${FRONTEND_FILE}: no 'export const ${FRONTEND_DECLARATION} = [...]' with string literals found`,
    );
  }

  const predicates = parseObjectKeys(repositoryContent, PREDICATES_DECLARATION);
  if (!predicates || predicates.keys.length === 0) {
    fatal.push(`${REPOSITORY_FILE}: no '${PREDICATES_DECLARATION} = { … }' object literal found`);
  }

  if (fatal.length > 0) {
    console.error('✗ check-return-stage-mirror: could not locate every declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error(`\n  docs: ${DOCS_REF}\n`);
    process.exit(1);
  }

  // Rule A — value + order equality against the frontend mirror.
  const feDiff = diffStageValues(core.values, frontend.values, 'frontend mirror');
  if (!feDiff.ok) {
    drifts.push({
      rule:
        `A: the stage vocabulary must be identical, in the same order, in both files ` +
        `(${CORE_DECLARATION} / ${FRONTEND_DECLARATION})`,
      locations: [
        `${CORE_FILE}:${core.line}  (authoritative)`,
        `${FRONTEND_FILE}:${frontend.line}  (hand-maintained mirror)`,
      ],
      issues: feDiff.issues,
    });
  }

  // Rule B (i)+(ii) — the SQL arm SET and ORDER, never per-arm semantics.
  const sqlDiff = diffStageValues(core.values, predicates.keys, `SQL ${PREDICATES_DECLARATION}`);
  if (!sqlDiff.ok) {
    drifts.push({
      rule:
        `B: ${PREDICATES_DECLARATION} must carry exactly one arm per stage, in precedence ` +
        `order (arm SEMANTICS are deliberately NOT compared — see the file header; ` +
        `RETURN_STAGE_FIXTURES is what proves meaning)`,
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
          `hand-written ladder that restates the precedence a third time`,
      ],
    });
  }

  if (drifts.length === 0) {
    console.log(
      `✓ check-return-stage-mirror: ${core.values.length} stage(s) identical and in ` +
        `precedence order across ${CORE_FILE}, ${FRONTEND_FILE} and the SQL twin in ${REPOSITORY_FILE}.`,
    );
    process.exit(0);
  }

  console.error(`✗ check-return-stage-mirror: ${drifts.length} drifted mirror(s).\n`);
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

  const file = (declName, entries) =>
    `/** header */\nexport const ${declName} = [\n${entries}\n] as const;\n`;

  // --- parser: array literals ------------------------------------------------
  const parsed = parseStageValues(file(CORE_DECLARATION, "  'declined',\n  'disposed',"), CORE_DECLARATION);
  expect('parses two literals', parsed?.values.join(','), 'declined,disposed');
  expect('reports the declaration line', parsed?.line, 2);

  expect(
    'strips line comments',
    parseStageValues(
      file(CORE_DECLARATION, "  'declined',\n  // 'ghost'\n  'disposed',"),
      CORE_DECLARATION,
    )?.values.join(','),
    'declined,disposed',
  );
  expect(
    'strips block comments',
    parseStageValues(
      file(CORE_DECLARATION, "  'declined',\n  /* 'ghost' */\n  'disposed',"),
      CORE_DECLARATION,
    )?.values.join(','),
    'declined,disposed',
  );
  expect(
    'reads the frontend declaration under its OWN name',
    parseStageValues(file(FRONTEND_DECLARATION, "  'declined',"), FRONTEND_DECLARATION)?.values.join(','),
    'declined',
  );
  expect(
    'selects the requested declaration, not the first one',
    parseStageValues(
      file('OtherValues', "  'other',") + file(CORE_DECLARATION, "  'declined',"),
      CORE_DECLARATION,
    )?.values.join(','),
    'declined',
  );
  expect('absent declaration → null', parseStageValues('export const X = 1;', CORE_DECLARATION), null);
  expect(
    'declaration present but empty → zero values (a FATAL, never a pass)',
    parseStageValues(file(CORE_DECLARATION, ''), CORE_DECLARATION)?.values.length,
    0,
  );

  // --- parser: object keys (the SQL Record twin) -----------------------------
  const predicates =
    `  private static readonly ${PREDICATES_DECLARATION}: Record<ReturnStage, string> = {\n` +
    `    // 1. a comment naming 'ghost'\n` +
    '    declined: `r."declinedAt" IS NOT NULL`,\n' +
    "    not_returned: 'COALESCE(sc.\"lineCount\", 0) > 0',\n" +
    "    'partially_received': `${Repo.RECEIVED} > 0`,\n" +
    "    awaiting_parcel: 'TRUE',\n" +
    '  };\n';
  const keys = parseObjectKeys(predicates, PREDICATES_DECLARATION);
  expect(
    'parses object keys, quoted and unquoted, ignoring comments and SQL string bodies',
    keys?.keys.join(','),
    'declined,not_returned,partially_received,awaiting_parcel',
  );
  expect('reports the object declaration line', keys?.line, 1);
  expect(
    'absent object declaration → null',
    parseObjectKeys('const other = { a: 1 };', PREDICATES_DECLARATION),
    null,
  );

  // --- differ ----------------------------------------------------------------
  const base = ['declined', 'not_returned', 'disposed'];
  expect('identical vocabularies pass', diffStageValues(base, [...base], 'm').ok, true);
  expect(
    'a stage missing from the mirror fails',
    diffStageValues(base, ['declined', 'not_returned'], 'm').ok,
    false,
  );
  expect(
    'a stage only in the mirror fails',
    diffStageValues(base, [...base, 'ghost'], 'm').ok,
    false,
  );
  expect(
    'a REORDER fails, because the order is the precedence ordinal',
    diffStageValues(base, ['not_returned', 'declined', 'disposed'], 'm').ok,
    false,
  );
  expect(
    'a reorder is reported as a reorder, not as a missing value',
    diffStageValues(base, ['not_returned', 'declined', 'disposed'], 'm').issues[0]?.includes(
      'DIFFERENT ORDER',
    ),
    true,
  );

  if (failures.length > 0) {
    console.error('✗ check-return-stage-mirror --self-check: parser/differ regressions.\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }

  console.log('✓ check-return-stage-mirror --self-check: parsers + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  await main();
}
