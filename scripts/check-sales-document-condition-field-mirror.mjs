#!/usr/bin/env node
/**
 * check-sales-document-condition-field-mirror.mjs
 *
 * Lint-time invariant for the two hand-maintained frontend mirrors of the
 * sales-document CONDITION FIELD vocabulary (#2170, ADR-041 decision 5).
 *
 * Rule. `SalesDocumentConditionFieldValues` in
 *   libs/core/src/sales-documents/domain/types/sales-document-condition.types.ts  (authoritative)
 * and both browser-side copies
 *   apps/web/src/features/sales-documents/api/sales-document-rules.types.ts       (rule editor)
 *   apps/web/src/features/orders/api/orders.types.ts                              (#3186 disclosure)
 * MUST contain exactly the same string literals.
 *
 * The browser bundle does not depend on `@openlinker/core` (#591), so each side
 * re-declares the vocabulary and the copies drift silently in BOTH directions:
 * a field added only to core never reaches the browser, and one added only to a
 * mirror type-checks against a value the API will never send. Until now a prose
 * "mirrored by convention, not by import" comment was the whole of the
 * enforcement; this is the enforcement.
 *
 * WHY BOTH MIRRORS, not only the one the review named. They are two copies of
 * the SAME core union with the same drift hazard, and guarding one while the
 * other drifts freely is a half-guard that reads as a whole one. The
 * `#3186` copy is the sharper case and the reason this script exists:
 * `describeCondition` narrows on `condition.field` arm by arm, so a fourth
 * field added in core arrives at RUNTIME while the union there still says
 * three - the unrecognised value falls to the echo-the-raw-field arm rather
 * than being caught at build time.
 *
 * ORDER IS DELIBERATELY NOT ASSERTED, and that is a decision rather than an
 * omission - `check-return-stage-mirror.mjs` is the complement, where the array
 * order IS the ordinal and a reorder is a hard failure. Here nothing iterates
 * the vocabulary for behaviour: core's array feeds an `@IsIn(...)` validator and
 * a Swagger `enum` (membership tests both), the rule-editor array is consumed
 * only to derive a type, and the third side is a TypeScript union on an
 * interface property, which has no order to compare in the first place.
 * Asserting a sequence across those three would fail a harmless tidy-up while
 * proving nothing about the property that matters.
 *
 * SCOPE, so the wrong guard is not trusted: this script compares VOCABULARIES.
 * It says nothing about whether `describeCondition` has an arm per field - a
 * field added to core AND to both mirrors with no rendering arm passes here, and
 * is covered instead by that function's own explicit unrecognised-field test in
 * `describe-matched-sales-document-rule.test.ts`. It also leaves the adjacent
 * `op` vocabulary alone: the mirrors spell that one as `'eq'` unioned with the
 * threshold operators, which is a composition of two core declarations rather
 * than a copy of either.
 *
 * All three files are parsed TEXTUALLY (no TypeScript import, no transpile) so
 * this script stays a zero-dependency `check:invariants` step like its siblings.
 * Comments are stripped before comparison.
 *
 * Run with `--self-check` to exercise the pure parsers + differ against
 * synthetic inputs (no filesystem) - mirrors `check-sales-document-reason-mirror.mjs`.
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
  'sales-documents',
  'domain',
  'types',
  'sales-document-condition.types.ts',
);
const CORE_NAME = 'SalesDocumentConditionFieldValues';

const RULES_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'sales-documents',
  'api',
  'sales-document-rules.types.ts',
);
const RULES_NAME = 'SALES_DOCUMENT_CONDITION_FIELD_VALUES';

const ORDERS_FILE = join('apps', 'web', 'src', 'features', 'orders', 'api', 'orders.types.ts');
const ORDERS_INTERFACE = 'SalesDocumentMatchedRuleCondition';
const ORDERS_PROPERTY = 'field';

const DOCS_REF = 'docs/architecture/adrs/041-sales-document-routing-policy.md';

/**
 * Blank out line and block comments so an annotated or commented-out entry can
 * never be read as a value. Done BEFORE any terminator or brace is located, not
 * after: a comment carrying a `;` or a `}` would otherwise end a slice early and
 * yield a short list, which fails closed but blames a declaration that is
 * perfectly fine.
 *
 * Comments are overwritten with spaces rather than DELETED, and their newlines
 * are kept, so every surviving character sits at its original offset and on its
 * original line. A deleting strip reports a line number from the stripped text,
 * which on a heavily commented `*.types.ts` barrel is off by dozens of lines -
 * i.e. it sends whoever has to fix the drift to the wrong declaration.
 */
function stripComments(source) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank);
}

/** Every single- or double-quoted string literal in `body`, in source order. */
function readLiterals(body) {
  return [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
}

/** 1-based line number of `index` within `source`. */
function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Extract the literals of `export const <name> = [...] as const;`.
 * Returns `{ line, values }`, or `null` when the declaration is absent.
 */
export function parseConstArray(source, name) {
  const stripped = stripComments(source);
  const decl = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`).exec(stripped);
  if (!decl) return null;

  const open = decl.index + decl[0].length - 1;
  const close = stripped.indexOf(']', open);
  if (close === -1) return null;

  return {
    line: lineOf(stripped, decl.index),
    values: readLiterals(stripped.slice(open + 1, close)),
  };
}

/**
 * Extract the literals of an inline union on one interface property, i.e. the
 * `'a' | 'b'` in `interface <interfaceName> { <property>: 'a' | 'b'; }`.
 *
 * Brace-matched to the interface body first, so a same-named property on a
 * DIFFERENT interface further down the file cannot be read instead - these
 * `*.types.ts` barrels hold dozens of shapes and several legitimately reuse a
 * property name. Terminated on the first `;` inside that body after the
 * property, which keeps a malformed union from running on into the next member:
 * it then returns a short list that fails the diff rather than a long one that
 * accidentally passes. Returns `{ line, values }`, or `null` when either the
 * interface or the property is absent.
 */
export function parseInterfacePropertyUnion(source, interfaceName, property) {
  const stripped = stripComments(source);
  const decl = new RegExp(`interface\\s+${interfaceName}\\s*(?:extends[^{]*)?\\{`).exec(stripped);
  if (!decl) return null;

  const open = decl.index + decl[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < stripped.length; i += 1) {
    if (stripped[i] === '{') depth += 1;
    else if (stripped[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;

  const body = stripped.slice(open + 1, close);
  const prop = new RegExp(`(?:^|[{;\\n])\\s*(?:readonly\\s+)?${property}\\s*\\??\\s*:`).exec(body);
  if (!prop) return null;

  const after = body.slice(prop.index + prop[0].length);
  const end = after.indexOf(';');
  if (end === -1) return null;

  // Report the line the property NAME sits on, not `prop.index`, which points at
  // the separator the regex had to consume to anchor the match and is therefore
  // the line ABOVE - an off-by-one that sends the reader to the wrong member.
  const nameOffset = prop[0].search(new RegExp(`${property}\\s*\\??\\s*:`));

  return {
    line: lineOf(stripped, open + 1 + prop.index + nameOffset),
    values: readLiterals(after.slice(0, end)),
  };
}

/**
 * Pure differ over the VALUE SET (see the header on why order is not compared).
 * Returns a list of human-readable issues; empty means the mirror is in step.
 */
export function diffFieldValues(core, mirror) {
  const issues = [];
  const coreSet = new Set(core);
  const mirrorSet = new Set(mirror);

  const missing = core.filter((v) => !mirrorSet.has(v));
  const extra = mirror.filter((v) => !coreSet.has(v));

  if (missing.length > 0) {
    issues.push(
      `present in core but MISSING from the mirror: ${missing.map((v) => `'${v}'`).join(', ')}`,
    );
  }
  if (extra.length > 0) {
    issues.push(
      `present in the mirror but MISSING from core: ${extra.map((v) => `'${v}'`).join(', ')}`,
    );
  }
  return issues;
}

async function main() {
  const [coreSource, rulesSource, ordersSource] = await Promise.all([
    readFile(join(repoRoot, CORE_FILE), 'utf8'),
    readFile(join(repoRoot, RULES_FILE), 'utf8'),
    readFile(join(repoRoot, ORDERS_FILE), 'utf8'),
  ]);

  const core = parseConstArray(coreSource, CORE_NAME);
  const mirrors = [
    {
      file: RULES_FILE,
      what: `export const ${RULES_NAME}`,
      parsed: parseConstArray(rulesSource, RULES_NAME),
    },
    {
      file: ORDERS_FILE,
      what: `${ORDERS_INTERFACE}.${ORDERS_PROPERTY}`,
      parsed: parseInterfacePropertyUnion(ordersSource, ORDERS_INTERFACE, ORDERS_PROPERTY),
    },
  ];

  const fatal = [];
  if (!core) fatal.push(`${CORE_FILE}: no 'export const ${CORE_NAME} = [...]' found`);
  for (const { file, what, parsed } of mirrors) {
    if (!parsed) fatal.push(`${file}: no '${what}' found`);
  }

  if (fatal.length > 0) {
    console.error(
      '✗ check-sales-document-condition-field-mirror: could not locate every declaration.\n',
    );
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  const drifts = [];
  for (const mirror of mirrors) {
    const issues = diffFieldValues(core.values, mirror.parsed.values);
    if (issues.length > 0) drifts.push({ ...mirror, issues });
  }

  if (drifts.length === 0) {
    console.log(
      `✓ check-sales-document-condition-field-mirror: ${core.values.length} condition field(s) ` +
        `identical in ${CORE_FILE} and both browser mirrors (${RULES_FILE}, ${ORDERS_FILE}).`,
    );
    process.exit(0);
  }

  console.error(
    `✗ check-sales-document-condition-field-mirror: ${drifts.length} drifted mirror(s).\n`,
  );
  for (const { file, what, parsed, issues } of drifts) {
    console.error(`  ${what}`);
    console.error(`    ${CORE_FILE}:${core.line}  (authoritative)`);
    console.error(`    ${file}:${parsed.line}  (hand-maintained mirror)`);
    for (const issue of issues) {
      console.error(
        `      rule: ${CORE_NAME} and every browser mirror must hold the same values - ${issue}`,
      );
    }
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parsers + differ against synthetic inputs (no filesystem). */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const array = (name, entries) =>
    `/** header */\nexport const ${name} = [\n${entries}\n] as const;\n`;

  const parsed = parseConstArray(array('A', "  'a-x',\n  'b-y',"), 'A');
  expect('parses two array literals', parsed?.values.join(','), 'a-x,b-y');
  expect('reports the array declaration line', parsed?.line, 2);
  expect(
    'strips line comments in an array',
    parseConstArray(
      array('A', "  'a-x',\n  // never written: 'ghost'\n  'b-y',"),
      'A',
    )?.values.join(','),
    'a-x,b-y',
  );
  expect(
    'strips block comments in an array',
    parseConstArray(array('A', "  'a-x',\n  /* 'ghost' */\n  'b-y',"), 'A')?.values.join(','),
    'a-x,b-y',
  );
  expect(
    'selects the requested array, not the first one',
    parseConstArray(array('A', "  'a-1',") + array('B', "  'b-1',"), 'B')?.values.join(','),
    'b-1',
  );
  expect('absent array declaration → null', parseConstArray('export const Other = [];', 'A'), null);

  const iface = (name, members) => `export interface ${name} {\n${members}\n}\n`;

  expect(
    'parses a single-line property union',
    parseInterfacePropertyUnion(
      iface('C', "  readonly field: 'a-x' | 'b-y';\n  readonly op: 'eq';"),
      'C',
      'field',
    )?.values.join(','),
    'a-x,b-y',
  );
  expect(
    'reports the line the property name sits on, not the line above',
    parseInterfacePropertyUnion(
      iface('C', "  readonly op: 'eq';\n  readonly field: 'a-x';"),
      'C',
      'field',
    )?.line,
    3,
  );
  expect(
    'parses a multi-line property union',
    parseInterfacePropertyUnion(
      iface('C', "  readonly field:\n    | 'a-x'\n    | 'b-y';\n  readonly op: 'eq';"),
      'C',
      'field',
    )?.values.join(','),
    'a-x,b-y',
  );
  expect(
    'parses an optional property union',
    parseInterfacePropertyUnion(iface('C', "  field?: 'a-x';"), 'C', 'field')?.values.join(','),
    'a-x',
  );
  expect(
    'strips comments inside the interface',
    parseInterfacePropertyUnion(
      iface('C', "  /** a 'ghost' note; with a semicolon */\n  readonly field: 'a-x';"),
      'C',
      'field',
    )?.values.join(','),
    'a-x',
  );
  // A property of the same name on a LATER interface must not be read instead,
  // and the union must not swallow the member that follows it.
  expect(
    'stays inside the requested interface',
    parseInterfacePropertyUnion(
      iface('C', "  readonly field: 'a-x';") + iface('D', "  readonly field: 'wrong';"),
      'C',
      'field',
    )?.values.join(','),
    'a-x',
  );
  expect(
    'stops at the property terminator',
    parseInterfacePropertyUnion(
      iface('C', "  readonly field: 'a-x';\n  readonly op: 'not-a-field';"),
      'C',
      'field',
    )?.values.join(','),
    'a-x',
  );
  expect(
    'a longer property name is not matched by a shorter request',
    parseInterfacePropertyUnion(iface('C', "  readonly fieldName: 'a-x';"), 'C', 'field'),
    null,
  );
  expect(
    'absent interface → null',
    parseInterfacePropertyUnion(iface('D', "  readonly field: 'a-x';"), 'C', 'field'),
    null,
  );
  expect(
    'absent property → null',
    parseInterfacePropertyUnion(iface('C', "  readonly op: 'eq';"), 'C', 'field'),
    null,
  );

  expect('identical sets → no issues', diffFieldValues(['a', 'b'], ['a', 'b']).length, 0);
  expect('missing in the mirror → issue', diffFieldValues(['a', 'b'], ['a']).length, 1);
  expect('extra in the mirror → issue', diffFieldValues(['a'], ['a', 'b']).length, 1);
  expect('both directions → two issues', diffFieldValues(['a', 'b'], ['a', 'c']).length, 2);
  // Order is deliberately NOT a failure here - see the header for why.
  expect('reordered → no issue', diffFieldValues(['a', 'b'], ['b', 'a']).length, 0);

  if (failures.length > 0) {
    console.error('✗ check-sales-document-condition-field-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log(
    '✓ check-sales-document-condition-field-mirror --self-check: parsers + differ behave.',
  );
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  // Explicit fatal handler, matching `check-sales-document-reason-mirror.mjs`. A
  // bare top-level `await main()` surfaces a rename of any mirrored file as a raw
  // unhandled-rejection stack instead of one actionable line.
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-sales-document-condition-field-mirror: fatal error:', err);
    process.exit(1);
  });
}
