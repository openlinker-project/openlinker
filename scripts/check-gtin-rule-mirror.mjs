#!/usr/bin/env node
/**
 * check-gtin-rule-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the GS1 GTIN
 * rule that decides which barcodes a bulk listing may publish (#3492).
 *
 * Rule. These three must describe the SAME GTIN predicate:
 *   apps/web/src/features/listings/components/bulk/bulk-policy.ts
 *       `isValidGtin` - admitted-length regex AND GS1 mod-10      (frontend mirror)
 *   libs/core/src/listings/application/services/bulk-listing-submit.service.ts
 *       `GTIN_LENGTHS` AND `isValidGs1CheckDigit`                  (backend, authoritative)
 *   apps/api/src/listings/http/dto/create-offer.dto.ts
 *       the `@Matches(...)` on `ean` - admitted override lengths   (request boundary)
 *
 * Why it matters. `apps/web` cannot import `@openlinker/core` (#591), so the
 * rule is a copy. Since #3492 the backend EXCLUDES a variant whose effective
 * EAN fails its checksum (instead of aborting the batch), so a frontend that
 * calls a barcode valid while the backend calls it invalid no longer produces a
 * loud failed submit - it produces a quiet per-variant shrink. The wizard is
 * only a reliable early warning while the two rules agree.
 *
 * How it compares, strongest first:
 *   1. Admitted LENGTH sets. Frontend: derived by EVALUATING `isValidGtin` on
 *      lengths 1..20 (a length is admitted when any check digit passes).
 *      Backend: the literal `GTIN_LENGTHS` set. DTO: the `@Matches` regex
 *      evaluated against all-digit strings of lengths 1..20.
 *   2. A fixed table of GS1 sample barcodes with KNOWN answers (valid and
 *      wrong-check-digit codes of every admitted length, mod-10-correct codes of
 *      lengths 9/10/11/15, non-digit input), evaluated by both implementations.
 *      This pins the pair to GS1 itself, not merely to each other.
 *   3. A deterministic sweep (every check digit over many bodies at lengths
 *      8..14) on which the two implementations must agree exactly.
 *
 * Both function BODIES are extracted textually and evaluated with
 * `new Function` - no TypeScript import, no transpile, no build - so this stays
 * a zero-dependency `check:invariants` step like its siblings. LIMIT: that only
 * works while each body is plain JavaScript (type annotations on the signature
 * are stripped; inside the body they are not) and self-contained (no reference
 * to a module-level binding). If either stops being true the evaluation throws
 * and this guard FAILS LOUDLY naming the function - it never silently skips the
 * behavioural comparison. Brace matching blanks comments and string literals
 * but not regex literals, which is safe for balanced quantifiers like `{12,14}`.
 *
 * SCOPE, so the wrong guard is not trusted: this compares the GTIN predicate
 * only. The backend deliberately TOLERATES a master-sourced code of an
 * off-GTIN length (it skips the checksum rather than excluding the variant)
 * while the wizard flags it - that asymmetry is more permissive on the backend,
 * cannot cause a silent exclusion, and is not checked here.
 *
 * Every source must yield at least one value (rule #3303): an empty length set
 * or a missing declaration is a broken parser, never a legitimately empty rule.
 *
 * Run with `--self-check` to exercise the pure extractors + comparator against
 * synthetic inputs (no filesystem), including injected drift on each side.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'listings',
  'components',
  'bulk',
  'bulk-policy.ts'
);
const BACKEND_FILE = join(
  'libs',
  'core',
  'src',
  'listings',
  'application',
  'services',
  'bulk-listing-submit.service.ts'
);
const DTO_FILE = join('apps', 'api', 'src', 'listings', 'http', 'dto', 'create-offer.dto.ts');

const FRONTEND_FN = 'isValidGtin';
const BACKEND_FN = 'isValidGs1CheckDigit';
const BACKEND_LENGTHS = 'GTIN_LENGTHS';
const DTO_PROPERTY = 'ean';
const DOCS_REF = 'docs/architecture-overview.md § Listings';

const MAX_PROBED_LENGTH = 20;

/**
 * Known GS1 answers. Off-GTIN lengths carry a mod-10-CORRECT check digit, so
 * only the length rule can reject them.
 */
const SAMPLE_TABLE = [
  ['96385074', true],
  ['40170725', true],
  ['96385075', false],
  ['036000291452', true],
  ['012345678905', true],
  ['036000291453', false],
  ['5901234123457', true],
  ['4006381333931', true],
  ['5901234123450', false],
  ['00012345600012', true],
  ['10614141000415', true],
  ['10614141000410', false],
  ['123456784', false],
  ['1234567895', false],
  ['12345678905', false],
  ['123456789012343', false],
  ['590123412345A', false],
  ['5901234 23457', false],
  ['', false],
];

/**
 * Blank `//` and `/* ... *\/` comments and '...' / "..." string literals to
 * spaces (newlines preserved). Length-preserving, so an index found in the
 * blanked copy is a valid index into the original.
 */
export function blankCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += i < source.length ? '  ' : '';
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      out += ' ';
      i += 1;
      while (i < source.length && source[i] !== ch && source[i] !== '\n') {
        if (source[i] === '\\') {
          out += ' ';
          i += 1;
        }
        out += ' ';
        i += 1;
      }
      out += i < source.length ? ' ' : '';
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Index of the bracket closing the one at `open`, on a blanked copy; -1 if none. */
function matchBracket(blanked, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < blanked.length; i += 1) {
    if (blanked[i] === openCh) depth += 1;
    else if (blanked[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Extract `function <name>(params): T { body }` as `{ line, params, body }`,
 * with parameter type annotations stripped. `null` when the function is absent
 * or its brackets do not balance.
 */
export function extractFunction(source, name) {
  const blanked = blankCommentsAndStrings(source);
  const declMatch = new RegExp(`function\\s+${name}\\s*\\(`).exec(blanked);
  if (!declMatch) return null;

  const openParen = declMatch.index + declMatch[0].length - 1;
  const closeParen = matchBracket(blanked, openParen, '(', ')');
  if (closeParen === -1) return null;
  const openBrace = blanked.indexOf('{', closeParen);
  if (openBrace === -1) return null;
  const closeBrace = matchBracket(blanked, openBrace, '{', '}');
  if (closeBrace === -1) return null;

  const params = source
    .slice(openParen + 1, closeParen)
    .split(',')
    .map((p) => p.trim().split(/[?:=\s]/)[0])
    .filter((p) => p !== '');
  const body = source.slice(openBrace + 1, closeBrace);
  const line = source.slice(0, declMatch.index).split('\n').length;
  return { line, params, body };
}

/** Compile an extracted function. Throws (with the cause) on TS syntax / bad body. */
export function compileFunction(extracted, name) {
  try {
    return new Function(...extracted.params, extracted.body);
  } catch (err) {
    throw new Error(
      `'${name}' body is not plain JavaScript (${err.message}) - keep it free of type syntax, ` +
        'or teach this guard to strip it'
    );
  }
}

/** Parse `const <name> = new Set([8, 12, ...])` to `{ line, values }`, or `null` when absent. */
export function parseLengthSet(source, name) {
  const blanked = blankCommentsAndStrings(source);
  const re = new RegExp(
    `const\\s+${name}(?:\\s*:[^=]+)?\\s*=\\s*new\\s+Set(?:<[^>]*>)?\\(\\s*\\[([^\\]]*)\\]`
  );
  const m = re.exec(blanked);
  if (!m) return null;
  const values = (m[1].match(/\d+/g) ?? []).map(Number);
  const line = source.slice(0, m.index).split('\n').length;
  return { line, values };
}

/**
 * The regex literal of the `@Matches(/.../flags` decorator that belongs to
 * `<property>?: string`, as `{ line, regex }`; `null` when absent.
 */
export function parsePropertyMatchesRegex(source, property) {
  const blanked = blankCommentsAndStrings(source);
  const propMatch = new RegExp(`\\n\\s*${property}\\??\\s*:`).exec(blanked);
  if (!propMatch) return null;
  const decoratorAt = blanked.lastIndexOf('@Matches(', propMatch.index);
  // The decorator must sit in this property's own decorator block: no `;`
  // (the end of a previous property) between it and the property.
  if (decoratorAt === -1 || blanked.slice(decoratorAt, propMatch.index).includes(';')) return null;

  let i = decoratorAt + '@Matches('.length;
  while (source[i] === ' ') i += 1;
  if (source[i] !== '/') return null;
  let pattern = '';
  let inClass = false;
  i += 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      pattern += ch + source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) break;
    else if (ch === '\n') return null;
    pattern += ch;
    i += 1;
  }
  const flags = /^[a-z]*/.exec(source.slice(i + 1))[0];
  const line = source.slice(0, decoratorAt).split('\n').length;
  return { line, regex: new RegExp(pattern, flags) };
}

/** Lengths 1..MAX at which `isValid` accepts at least one check digit. */
export function admittedLengthsOf(isValid) {
  const lengths = [];
  for (let n = 1; n <= MAX_PROBED_LENGTH; n += 1) {
    const body = '9'.repeat(n - 1);
    for (let d = 0; d <= 9; d += 1) {
      if (isValid(`${body}${d}`)) {
        lengths.push(n);
        break;
      }
    }
  }
  return lengths;
}

const sameSet = (a, b) => a.length === b.length && a.every((v) => b.includes(v));
const fmt = (values) => `{${[...values].sort((x, y) => x - y).join(', ')}}`;

/**
 * Pure comparator over the three source texts. Returns `{ fatal, issues, stats }`:
 * `fatal` = something could not be located or evaluated; `issues` = a drift.
 */
export function compareGtinRules({ frontendSource, backendSource, dtoSource }) {
  const fatal = [];
  const issues = [];

  const feFn = extractFunction(frontendSource, FRONTEND_FN);
  const beFn = extractFunction(backendSource, BACKEND_FN);
  const beLengths = parseLengthSet(backendSource, BACKEND_LENGTHS);
  const dtoRegex = parsePropertyMatchesRegex(dtoSource, DTO_PROPERTY);

  if (!feFn) fatal.push(`${FRONTEND_FILE}: no 'function ${FRONTEND_FN}(...) { ... }' found`);
  if (!beFn) fatal.push(`${BACKEND_FILE}: no 'function ${BACKEND_FN}(...) { ... }' found`);
  if (!beLengths) {
    fatal.push(`${BACKEND_FILE}: no 'const ${BACKEND_LENGTHS} = new Set([...])' found`);
  } else if (beLengths.values.length === 0) {
    fatal.push(
      `${BACKEND_FILE}: '${BACKEND_LENGTHS}' parsed to ZERO lengths - the PARSER is broken`
    );
  }
  if (!dtoRegex) fatal.push(`${DTO_FILE}: no '@Matches(/.../)' on '${DTO_PROPERTY}' found`);
  if (fatal.length > 0) return { fatal, issues, stats: null };

  let feIsValid;
  let beCheckDigit;
  try {
    feIsValid = compileFunction(feFn, FRONTEND_FN);
    beCheckDigit = compileFunction(beFn, BACKEND_FN);
  } catch (err) {
    return { fatal: [err.message], issues, stats: null };
  }
  const beIsValid = (code) => beLengths.values.includes(code.length) && beCheckDigit(code) === true;

  let feLengths;
  try {
    feLengths = admittedLengthsOf((code) => feIsValid(code) === true);
  } catch (err) {
    return {
      fatal: [
        `'${FRONTEND_FN}' threw while evaluated (${err.message}) - it must be self-contained`,
      ],
      issues,
      stats: null,
    };
  }
  const dtoLengths = [];
  for (let n = 1; n <= MAX_PROBED_LENGTH; n += 1) {
    if (dtoRegex.regex.test('0'.repeat(n))) dtoLengths.push(n);
  }
  if (feLengths.length === 0) {
    fatal.push(`${FRONTEND_FILE}: '${FRONTEND_FN}' admits ZERO lengths - evaluation is broken`);
  }
  if (dtoLengths.length === 0) {
    fatal.push(
      `${DTO_FILE}: the '${DTO_PROPERTY}' @Matches regex admits ZERO lengths - parse is broken`
    );
  }
  if (fatal.length > 0) return { fatal, issues, stats: null };

  if (!sameSet(feLengths, beLengths.values)) {
    issues.push(
      `admitted lengths differ: ${FRONTEND_FN} ${fmt(feLengths)} vs ${BACKEND_LENGTHS} ${fmt(beLengths.values)}`
    );
  }
  if (!sameSet(dtoLengths, beLengths.values)) {
    issues.push(
      `admitted lengths differ: DTO @Matches ${fmt(dtoLengths)} vs ${BACKEND_LENGTHS} ${fmt(beLengths.values)}`
    );
  }

  let evaluated = 0;
  try {
    for (const [code, expected] of SAMPLE_TABLE) {
      const fe = feIsValid(code) === true;
      const be = beIsValid(code);
      evaluated += 1;
      if (fe !== expected) issues.push(`${FRONTEND_FN}('${code}') is ${fe}, GS1 says ${expected}`);
      if (be !== expected) issues.push(`backend rule('${code}') is ${be}, GS1 says ${expected}`);
    }

    let disagreements = 0;
    let firstDisagreement = null;
    for (let n = 8; n <= 14; n += 1) {
      for (let seed = 0; seed < 50; seed += 1) {
        // Deterministic varied bodies (no Math.random, so a failure reproduces).
        let body = '';
        for (let k = 0; k < n - 1; k += 1) body += String((seed * 7 + k * k * 3 + n) % 10);
        for (let d = 0; d <= 9; d += 1) {
          const code = `${body}${d}`;
          evaluated += 1;
          if ((feIsValid(code) === true) !== beIsValid(code)) {
            disagreements += 1;
            firstDisagreement ??= code;
          }
        }
      }
    }
    if (disagreements > 0) {
      issues.push(
        `${FRONTEND_FN} and the backend rule disagree on ${disagreements} swept code(s), e.g. '${firstDisagreement}'`
      );
    }
  } catch (err) {
    return {
      fatal: [
        `a GTIN implementation threw while evaluated (${err.message}) - it must be self-contained`,
      ],
      issues,
      stats: null,
    };
  }
  if (evaluated === 0) fatal.push('evaluated ZERO sample codes - the comparison is broken');

  return {
    fatal,
    issues,
    stats: {
      lengths: beLengths.values,
      evaluated,
      lines: { fe: feFn.line, be: beFn.line, beLengths: beLengths.line, dto: dtoRegex.line },
    },
  };
}

async function main() {
  const [frontendSource, backendSource, dtoSource] = await Promise.all([
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
    readFile(join(repoRoot, BACKEND_FILE), 'utf8'),
    readFile(join(repoRoot, DTO_FILE), 'utf8'),
  ]);

  const { fatal, issues, stats } = compareGtinRules({ frontendSource, backendSource, dtoSource });
  if (fatal.length > 0) {
    console.error('✗ check-gtin-rule-mirror: could not locate or evaluate the rule.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }
  if (issues.length === 0) {
    console.log(
      `✓ check-gtin-rule-mirror: lengths ${fmt(stats.lengths)} and ${stats.evaluated} evaluated code(s) ` +
        `agree across ${FRONTEND_FILE}, ${BACKEND_FILE} and ${DTO_FILE}.`
    );
    process.exit(0);
  }

  console.error('✗ check-gtin-rule-mirror: the GTIN rule drifted.\n');
  console.error(`    ${BACKEND_FILE}:${stats.lines.be} ${BACKEND_FN}  (authoritative)`);
  console.error(`    ${BACKEND_FILE}:${stats.lines.beLengths} ${BACKEND_LENGTHS}  (authoritative)`);
  console.error(`    ${FRONTEND_FILE}:${stats.lines.fe} ${FRONTEND_FN}  (hand-maintained mirror)`);
  console.error(
    `    ${DTO_FILE}:${stats.lines.dto} @Matches on ${DTO_PROPERTY}  (request boundary)`
  );
  for (const issue of issues)
    console.error(`      rule: one GTIN predicate on both sides - ${issue}`);
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure extractors + comparator against synthetic inputs (no filesystem). */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const checksumLoop = (w1, w2) =>
    `  const digits = [...code].map(Number);\n` +
    `  const check = digits[digits.length - 1];\n` +
    `  const body = digits.slice(0, -1);\n` +
    `  let sum = 0;\n` +
    `  for (let i = body.length - 1, pos = 0; i >= 0; i--, pos++) {\n` +
    `    sum += body[i] * (pos % 2 === 0 ? ${w1} : ${w2});\n` +
    `  }\n` +
    `  return (10 - (sum % 10)) % 10 === check;\n`;
  const fe = (lengthRe = '^(\\d{8}|\\d{12,14})$', w = [3, 1]) =>
    `/** GS1 { check } - a stray brace in a comment: } */\n` +
    `export function isValidGtin(code: string): boolean {\n` +
    `  if (!/${lengthRe}/.test(code)) return false; // '}' in a comment\n` +
    checksumLoop(w[0], w[1]) +
    `}\n\nexport function toGtin14(code: string): string {\n  return code.padStart(14, '0');\n}\n`;
  const be = (lengths = '8, 12, 13, 14', w = [3, 1]) =>
    `const GTIN_LENGTHS = new Set([${lengths}]);\n\n` +
    `function isValidGs1CheckDigit(code: string): boolean {\n` +
    `  if (!/^\\d+$/.test(code)) return false;\n` +
    checksumLoop(w[0], w[1]) +
    `}\n`;
  const dto = (re = '^(\\d{8}|\\d{12,14})$') =>
    `export class CreateOfferOverridesDto {\n  @IsString()\n  title?: string;\n\n` +
    `  @IsOptional()\n  @Matches(/${re}/, { message: 'ean must be 8, 12, 13, or 14 digits' })\n` +
    `  ean?: string;\n}\n`;

  const run = (o = {}) =>
    compareGtinRules({
      frontendSource: o.fe ?? fe(),
      backendSource: o.be ?? be(),
      dtoSource: o.dto ?? dto(),
    });

  const clean = run();
  expect('identical rules → no fatal', clean.fatal.length, 0);
  expect('identical rules → no issues', clean.issues.length, 0);
  expect(
    'identical rules → evaluates the sample table + sweep',
    (clean.stats?.evaluated ?? 0) > 3000,
    true
  );

  const extracted = extractFunction(fe(), 'isValidGtin');
  expect('strips the parameter type annotation', extracted?.params.join(','), 'code');
  expect(
    'a "}" in a comment or string does not truncate the body',
    extracted?.body.includes('return (10'),
    true
  );
  expect('absent function → null', extractFunction('const x = 1;', 'isValidGtin'), null);

  expect(
    'parses GTIN_LENGTHS',
    parseLengthSet(be(), 'GTIN_LENGTHS')?.values.join(','),
    '8,12,13,14'
  );
  expect(
    'a GTIN_LENGTHS mention in a comment is not the declaration',
    parseLengthSet(
      '// const GTIN_LENGTHS = new Set([9]);\nconst GTIN_LENGTHS = new Set([8]);',
      'GTIN_LENGTHS'
    )?.values.join(','),
    '8'
  );
  expect(
    'picks the @Matches of the ean property, not another one',
    parsePropertyMatchesRegex(
      `class D {\n  @Matches(/^x$/)\n  title?: string;\n${dto().split('\n').slice(4).join('\n')}`,
      'ean'
    )?.regex.source,
    '^(\\d{8}|\\d{12,14})$'
  );

  expect(
    'FE admits an extra length → issue',
    run({ fe: fe('^(\\d{8}|\\d{11,14})$') }).issues.length > 0,
    true
  );
  expect('BE length set loses 12 → issue', run({ be: be('8, 13, 14') }).issues.length > 0, true);
  expect('DTO admits 9..14 → issue', run({ dto: dto('^\\d{8,14}$') }).issues.length > 0, true);
  expect(
    'BE weighting swapped → issue',
    run({ be: be(undefined, [1, 3]) }).issues.length > 0,
    true
  );
  expect(
    'BOTH sides drift identically → still caught by the GS1 sample table',
    run({ fe: fe(undefined, [1, 3]), be: be(undefined, [1, 3]) }).issues.length > 0,
    true
  );

  expect('empty GTIN_LENGTHS → fatal (zero floor)', run({ be: be('') }).fatal.length > 0, true);
  expect(
    'missing frontend function → fatal',
    run({ fe: 'export const nothing = 1;\n' }).fatal.length > 0,
    true
  );
  expect(
    'missing DTO decorator → fatal',
    run({ dto: 'class D {\n  ean?: string;\n}\n' }).fatal.length > 0,
    true
  );
  expect(
    'type syntax inside a body → fatal, not a silent skip',
    run({ be: be().replace('const check = ', 'const check = <number>') }).fatal.length > 0,
    true
  );
  expect(
    'a body referencing a module-level binding → fatal, not a silent skip',
    run({ fe: fe().replace('if (!/', 'if (!GTIN_RE && !/') }).fatal.length > 0,
    true
  );

  if (failures.length > 0) {
    console.error('✗ check-gtin-rule-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-gtin-rule-mirror --self-check: extractors + comparator behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-gtin-rule-mirror: fatal error:', err);
    process.exit(1);
  });
}
