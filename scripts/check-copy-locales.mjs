#!/usr/bin/env node
/**
 * check-copy-locales
 *
 * Guards the typed copy files of the admin app (ADR-079, #3859). Every
 * `defineCopy({ en, pl })` call in a non-test file under `apps/web/src` is
 * read through the TypeScript AST and checked:
 *
 *   1. Readable: every language value and leaf must be a literal object, a
 *      plain string, a `{name}`-only template or a `fit(<number>, <text>)`
 *      call. `as const`, `satisfies` and parentheses are looked through.
 *      Anything else (a variable, a spread, a computed key, `${}` in a
 *      template, a non-literal budget) is an error, never a silent skip,
 *      and so is a call with no English text at all.
 *   2. Placeholders: a Polish string uses the same set of `{name}`
 *      placeholders as its English key (plural `few` / `many` compare against
 *      English `other`). A missing or misspelt placeholder renders as raw text.
 *   3. Budgets: a key written `fit(n, 'text')` must stay within n characters
 *      in every language - it sits in a button, nav item, chip or header.
 *   4. No em dash (U+2014) in copy; the house style is a plain hyphen.
 *   5. Warning only: Polish more than 1.6x and 15+ characters longer than
 *      English, for a reviewer to look at the layout.
 *   6. Warning only: a key whose name appears in no other source file, so it
 *      is probably unused. A heuristic - a common name such as `title` is
 *      always "used" - so it reports and never fails.
 *
 * The scan fails when it finds fewer copy files than MIN_COPY_FILES: a walk
 * that finds nothing must not read as "all clean". TypeScript already rejects
 * a Polish key English lacks, so key parity is not repeated here.
 *
 * Not a gate: `--report` prints how far each language is translated, file by
 * file, so someone adding or finishing a language can see the gaps. A plural
 * (an English `{ one, other }` entry) counts as ONE key, translated when the
 * language has a non-empty `other` form; Polish-only `few` / `many` are never
 * extra keys, because totals are English's. An empty string counts as missing,
 * the same way `resolveCopy` treats it. It reads the same files, through the
 * same extraction and the same `LANGUAGES` list as the normal run, so a new
 * language shows up with no extra code. It always exits 0.
 *
 * Usage:
 *   node scripts/check-copy-locales.mjs
 *   node scripts/check-copy-locales.mjs --self-check   (proves every rule fires)
 *   node scripts/check-copy-locales.mjs --report       (per-file coverage, most missing first, plus TOTAL)
 *   node scripts/check-copy-locales.mjs --report --missing   (also list the missing key paths; --verbose is an alias)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN_ROOT = join(ROOT, 'apps/web/src');
const EM_DASH = '—';
const PLACEHOLDER = /\{(\w+)\}/g;
const PLURAL_KEYS = new Set(['one', 'few', 'many', 'other']);
const LANGUAGES = ['en', 'pl'];

/** Today: `shared/ui/ui.copy.ts` and `shared/format/format.copy.ts`. */
const MIN_COPY_FILES = 2;

// ---------------------------------------------------------------------------
// Pure parsing (exercised by --self-check)
// ---------------------------------------------------------------------------

function unwrap(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function lineOf(node, sf) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

const UNREADABLE = Symbol('unreadable');

/** A leaf, `null` when the node is not leaf-shaped, or UNREADABLE (already reported). */
function readLeaf(raw, sf, key, problems) {
  const node = unwrap(raw);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { text: node.text, budget: null, line: lineOf(node, sf) };
  }
  if (ts.isTemplateExpression(node)) {
    problems.push({ line: lineOf(node, sf), message: `${key} uses \${...}; copy takes {name} placeholders.` });
    return UNREADABLE;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fit') {
    const [budget, text] = node.arguments;
    if (node.arguments.length !== 2 || !ts.isNumericLiteral(unwrap(budget))) {
      problems.push({ line: lineOf(node, sf), message: `${key} fit() needs a number literal budget and the text.` });
      return UNREADABLE;
    }
    const inner = readLeaf(text, sf, key, problems);
    if (inner === UNREADABLE) return UNREADABLE;
    if (inner === null) {
      problems.push({ line: lineOf(node, sf), message: `${key} fit() text must be a string literal.` });
      return UNREADABLE;
    }
    return { ...inner, budget: Number(unwrap(budget).text) };
  }
  return null;
}

function walk(raw, sf, path, out, problems) {
  const node = unwrap(raw);
  if (!ts.isObjectLiteralExpression(node)) {
    problems.push({
      line: lineOf(node, sf),
      message: `${path} is not a string, a fit() call or an object literal, so it cannot be checked.`,
    });
    return;
  }
  for (const prop of node.properties) {
    const name = ts.isPropertyAssignment(prop) ? propertyName(prop.name) : null;
    if (name === null) {
      problems.push({
        line: lineOf(prop, sf),
        message: `${path || '(root)'} has a spread, shorthand, method or computed key; write every key inline.`,
      });
      continue;
    }
    const key = path ? `${path}.${name}` : name;
    const leaf = readLeaf(prop.initializer, sf, key, problems);
    if (leaf === UNREADABLE) continue;
    if (leaf) out.set(key, leaf);
    else walk(prop.initializer, sf, key, out, problems);
  }
}

/**
 * Reads every `defineCopy` call in a source file.
 * @returns {{ copies: Array<{ en: Map, pl: Map, line: number }>, problems: Array<{ line: number, message: string }> }}
 */
export function extractCopies(source, fileName = 'copy.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const copies = [];
  const problems = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineCopy') {
      const line = lineOf(node, sf);
      const arg = node.arguments.length === 1 ? unwrap(node.arguments[0]) : null;
      if (!arg || !ts.isObjectLiteralExpression(arg)) {
        problems.push({ line, message: 'defineCopy() must take one inline { en, pl } object.' });
      } else {
        const langs = Object.fromEntries(LANGUAGES.map((lang) => [lang, new Map()]));
        for (const prop of arg.properties) {
          const name = ts.isPropertyAssignment(prop) ? propertyName(prop.name) : null;
          if (name === null || !LANGUAGES.includes(name)) {
            problems.push({
              line: lineOf(prop, sf),
              message: 'defineCopy() takes inline `en:` and `pl:` objects only; a variable or spread cannot be checked.',
            });
            continue;
          }
          walk(prop.initializer, sf, name, langs[name], problems);
        }
        // Keys are recorded relative to the language root.
        for (const lang of LANGUAGES) {
          langs[lang] = new Map([...langs[lang]].map(([k, v]) => [k.slice(lang.length + 1), v]));
        }
        if (langs.en.size === 0) {
          problems.push({ line, message: 'defineCopy() has no readable English text.' });
        }
        copies.push({ ...langs, line });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { copies, problems };
}

function placeholderSet(text) {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort().join(',');
}

/** English counterpart of a Polish key: plural few/many compare to `other`. */
function englishKeyFor(plKey, en) {
  if (en.has(plKey)) return plKey;
  const dot = plKey.lastIndexOf('.');
  const last = plKey.slice(dot + 1);
  if (PLURAL_KEYS.has(last)) {
    const other = `${plKey.slice(0, dot)}.other`;
    if (en.has(other)) return other;
  }
  return null;
}

export function checkCopies({ copies, problems }, fileLabel) {
  const errors = problems.map((p) => `${fileLabel}:${p.line} ${p.message}`);
  const warnings = [];
  for (const { en, pl } of copies) {
    for (const [lang, leaves] of [['en', en], ['pl', pl]]) {
      for (const [key, leaf] of leaves) {
        if (leaf.text.includes(EM_DASH)) {
          errors.push(`${fileLabel}:${leaf.line} ${lang}.${key} contains an em dash; use a plain hyphen.`);
        }
      }
    }
    for (const [key, enLeaf] of en) {
      if (enLeaf.budget !== null && enLeaf.text.length > enLeaf.budget) {
        errors.push(
          `${fileLabel}:${enLeaf.line} en.${key} "${enLeaf.text}" is ${enLeaf.text.length} chars, budget ${enLeaf.budget}. Shorten the English text or raise the budget in fit().`,
        );
      }
    }
    for (const [key, plLeaf] of pl) {
      const enKey = englishKeyFor(key, en);
      if (enKey === null) continue;
      const enLeaf = en.get(enKey);
      if (placeholderSet(plLeaf.text) !== placeholderSet(enLeaf.text)) {
        errors.push(
          `${fileLabel}:${plLeaf.line} pl.${key} placeholders {${placeholderSet(plLeaf.text)}} do not match en {${placeholderSet(enLeaf.text)}}. Keep every {name} token exactly as English writes it; a misspelt one renders as raw text.`,
        );
      }
      const budget = plLeaf.budget ?? enLeaf.budget;
      if (budget !== null && plLeaf.text.length > budget) {
        errors.push(
          `${fileLabel}:${plLeaf.line} pl.${key} "${plLeaf.text}" is ${plLeaf.text.length} chars, budget ${budget} (en: ${enLeaf.text.length}). Shorten it or raise the budget.`,
        );
      }
      if (plLeaf.text.length > enLeaf.text.length * 1.6 && plLeaf.text.length - enLeaf.text.length >= 15) {
        warnings.push(
          `${fileLabel}:${plLeaf.line} pl.${key} is ${(plLeaf.text.length / enLeaf.text.length).toFixed(1)}x longer than en (+${plLeaf.text.length - enLeaf.text.length} chars).`,
        );
      }
    }
  }
  return { errors, warnings };
}

/** The name a component reads a key by: the last segment, or a plural's parent. */
function readName(key) {
  const parts = key.split('.');
  const last = parts[parts.length - 1];
  return PLURAL_KEYS.has(last) && parts.length > 1 ? parts[parts.length - 2] : last;
}

export function findUnusedKeys({ copies }, fileLabel, usedWords) {
  const warnings = [];
  for (const { en } of copies) {
    const reported = new Set();
    for (const [key, leaf] of en) {
      const last = key.slice(key.lastIndexOf('.') + 1);
      // A plural is one key to the component that reads it, so report it once.
      const entry = PLURAL_KEYS.has(last) && key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : key;
      if (reported.has(entry) || usedWords.has(readName(key))) continue;
      reported.add(entry);
      warnings.push(`${fileLabel}:${leaf.line} en.${entry} looks unused: "${readName(key)}" appears in no other file.`);
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Filesystem scan
// ---------------------------------------------------------------------------

function listSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `defineCopy` file under the scan root, and the words used elsewhere. */
function collectCopyFiles() {
  const copyFiles = [];
  const usedWords = new Set();
  for (const file of listSourceFiles(SCAN_ROOT)) {
    const source = readFileSync(file, 'utf8');
    const parsed = source.includes('defineCopy(') ? extractCopies(source, file) : null;
    if (parsed && (parsed.copies.length > 0 || parsed.problems.length > 0)) {
      copyFiles.push({ file, parsed });
    } else {
      for (const word of source.match(/\w+/g) ?? []) usedWords.add(word);
    }
  }
  return { copyFiles, usedWords };
}

/** The `e2e` fixture pins the language by writing the key the app reads. */
function storageKeyMirrorErrors() {
  const keyOf = (path, pattern) => readFileSync(join(ROOT, path), 'utf8').match(pattern)?.[1];
  const app = keyOf('apps/web/src/shared/i18n/resolve-locale.ts', /LOCALE_STORAGE_KEY\s*=\s*'([^']+)'/);
  const e2e = keyOf('apps/e2e/src/fixtures/test.ts', /localStorage\.getItem\('([^']+)'\)/);
  if (!app || !e2e) return ['could not read the locale storage key from resolve-locale.ts and the e2e fixture.'];
  return app === e2e
    ? []
    : [`apps/e2e/src/fixtures/test.ts pins "${e2e}" but the app reads "${app}" (LOCALE_STORAGE_KEY); the e2e English pin would silently stop working.`];
}

// ---------------------------------------------------------------------------
// Coverage report (--report)
// ---------------------------------------------------------------------------

/** The unit a key counts as: a plural's parent path, or the key itself. */
function unitOf(key) {
  const dot = key.lastIndexOf('.');
  return dot > 0 && PLURAL_KEYS.has(key.slice(dot + 1)) ? key.slice(0, dot) : key;
}

/**
 * How much of English one language has translated. Units are English's: a
 * plural group is one unit (translated when `<unit>.other` is non-empty), any
 * other leaf is one unit (translated when the key exists and is non-empty).
 * Keys only the language has (Polish `few` / `many`) never add to the total.
 */
export function coverageOf(copies, language) {
  let total = 0;
  let translated = 0;
  const missing = [];
  copies.forEach((copy, index) => {
    const prefix = copies.length > 1 ? `[${index + 1}] ` : '';
    const units = new Map();
    for (const key of copy.en.keys()) {
      const unit = unitOf(key);
      units.set(unit, unit === key ? key : `${unit}.other`);
    }
    const leaves = copy[language];
    for (const [unit, probe] of units) {
      total += 1;
      if ((leaves.get(probe)?.text ?? '') !== '') translated += 1;
      else missing.push(`${prefix}${unit}`);
    }
  });
  return { total, translated, missing };
}

const percent = (translated, total) => (total === 0 ? '-' : `${Math.floor((translated / total) * 100)}%`);

/** @returns {string[]} report lines for the languages other than English. */
export function formatReport(entries, languages, { listMissing = false } = {}) {
  const targets = languages.filter((language) => language !== 'en');
  const rows = entries.map(({ label, copies, unreadable }) => {
    const per = targets.map((language) => ({ language, ...coverageOf(copies, language) }));
    return { label, per, unreadable, missingCount: per.reduce((sum, c) => sum + c.missing.length, 0) };
  });
  rows.sort((a, b) => b.missingCount - a.missingCount || a.label.localeCompare(b.label));
  const width = Math.max(5, ...rows.map((r) => r.label.length));
  const lines = [];
  for (const row of rows) {
    const cells = row.per.map((c) => `${c.language} ${c.translated}/${c.total} (${percent(c.translated, c.total)})`);
    const note = row.unreadable > 0 ? `   [${row.unreadable} unreadable shape(s), see the normal run]` : '';
    lines.push(`${row.label.padEnd(width)}   ${cells.join('   ')}${note}`);
    if (listMissing) {
      for (const c of row.per) for (const key of c.missing) lines.push(`    ${c.language} missing: ${key}`);
    }
  }
  const totals = targets.map((language) => {
    let total = 0;
    let translated = 0;
    for (const { copies } of entries) {
      const c = coverageOf(copies, language);
      total += c.total;
      translated += c.translated;
    }
    return `${language} ${translated}/${total} (${percent(translated, total)})`;
  });
  lines.push(`${'TOTAL'.padEnd(width)}   ${totals.join('   ')}`);
  return lines;
}

function report(listMissing) {
  const { copyFiles } = collectCopyFiles();
  const entries = copyFiles.map(({ file, parsed }) => ({
    label: relative(ROOT, file),
    copies: parsed.copies,
    unreadable: parsed.problems.length,
  }));
  for (const line of formatReport(entries, LANGUAGES, { listMissing })) console.log(line);
}

function run() {
  const { copyFiles, usedWords } = collectCopyFiles();

  const errors = [];
  const warnings = [];
  if (copyFiles.length < MIN_COPY_FILES) {
    errors.push(
      `found ${copyFiles.length} copy file(s) under ${relative(ROOT, SCAN_ROOT)}, expected at least ${MIN_COPY_FILES}. ` +
        'The scan finding nothing is a broken scan, not a clean tree.',
    );
  }
  errors.push(...storageKeyMirrorErrors());
  for (const { file, parsed } of copyFiles) {
    const label = relative(ROOT, file);
    const result = checkCopies(parsed, label);
    errors.push(...result.errors);
    warnings.push(...result.warnings, ...findUnusedKeys(parsed, label, usedWords));
  }

  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (errors.length > 0) {
    console.error(`✗ check-copy-locales: ${errors.length} problem(s)\n`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`✓ check-copy-locales: ${copyFiles.length} copy file(s) checked, ${warnings.length} warning(s).`);
}

// ---------------------------------------------------------------------------
// --self-check
// ---------------------------------------------------------------------------

function selfCheck() {
  const failures = [];
  let cases = 0;
  const analyse = (source) => checkCopies(extractCopies(source), 'fixture.copy.ts');

  const expectProblem = (name, source, fragment) => {
    cases += 1;
    const { errors } = analyse(source);
    if (!errors.some((e) => e.includes(fragment))) {
      failures.push(`${name}: expected an error containing "${fragment}", got ${JSON.stringify(errors)}`);
    }
  };
  const expectClean = (name, source, leaves) => {
    cases += 1;
    const parsed = extractCopies(source);
    const { errors } = checkCopies(parsed, 'fixture.copy.ts');
    const read = parsed.copies.reduce((sum, c) => sum + c.en.size + c.pl.size, 0);
    if (errors.length > 0) failures.push(`${name}: expected no errors, got ${JSON.stringify(errors)}`);
    if (read !== leaves) failures.push(`${name}: expected ${leaves} leaves read, got ${read}`);
  };
  const expectWarning = (name, source, fragment) => {
    cases += 1;
    const { warnings } = analyse(source);
    if (!warnings.some((w) => w.includes(fragment))) {
      failures.push(`${name}: expected a warning containing "${fragment}", got ${JSON.stringify(warnings)}`);
    }
  };

  // Rules fire.
  expectProblem('placeholder mismatch', "defineCopy({ en: { a: 'Hi {name}' }, pl: { a: 'Cześć {imie}' } });", 'placeholders');
  expectProblem(
    'Polish budget overflow',
    "defineCopy({ en: { b: fit(15, 'Create shipment') }, pl: { b: 'Utwórz nową przesyłkę kurierską' } });",
    'budget 15',
  );
  expectProblem('English budget overflow', "defineCopy({ en: { b: fit(5, 'Create shipment') }, pl: {} });", 'en.b');
  expectProblem('em dash', "defineCopy({ en: { c: 'Demo — read-only' }, pl: {} });", 'em dash');
  expectProblem('em dash in a template', 'defineCopy({ en: { c: `Demo — read-only` }, pl: {} });', 'em dash');

  // Shapes it cannot read are errors, never a silent pass.
  expectProblem('language held in a variable', 'const en = {}; defineCopy({ en, pl: {} });', 'inline');
  expectProblem('argument held in a variable', 'const c = {}; defineCopy(c);', 'one inline');
  expectProblem('spread inside a language', "defineCopy({ en: { ...base, a: 'A' }, pl: {} });", 'spread');
  expectProblem('template with a value', "defineCopy({ en: { a: `Hi ${name}` }, pl: {} });", 'placeholders');
  expectProblem('non-literal budget', "defineCopy({ en: { a: fit(MAX, 'Save') }, pl: {} });", 'number literal');
  expectProblem('no English text', 'defineCopy({ en: {}, pl: {} });', 'no readable English');
  expectProblem('leaf held in a variable', 'defineCopy({ en: { a: label }, pl: {} });', 'cannot be checked');

  // Shapes it can read are read, not skipped: the leaf count proves it.
  expectClean(
    'plural forms compare to other',
    "defineCopy({ en: { n: { one: '{n} order', other: '{n} orders' } }, pl: { n: { one: '{n} zamówienie', few: '{n} zamówienia', many: '{n} zamówień', other: '{n} zamówienia' } } });",
    6,
  );
  expectClean('partial Polish', "defineCopy({ en: { a: 'Orders', b: 'More' }, pl: { a: 'Zamówienia' } });", 3);
  expectClean(
    'as const, satisfies and quoted keys are looked through',
    "defineCopy({ 'en': { a: 'Hi {name}' } as const, pl: ({ a: 'Cześć {name}' }) satisfies object });",
    2,
  );
  expectClean('a placeholder used twice', "defineCopy({ en: { a: '{n} of {n}' }, pl: { a: '{n} z {n}' } });", 2);

  // Warnings fire.
  expectWarning(
    'length warning',
    "defineCopy({ en: { a: 'Save' }, pl: { a: 'Zapisz wszystkie zmiany teraz' } });",
    'longer than en',
  );
  cases += 1;
  const unused = findUnusedKeys(
    extractCopies("defineCopy({ en: { usedKey: 'A', strayKey: { one: 'x', other: 'y' } }, pl: {} });"),
    'fixture.copy.ts',
    new Set(['usedKey']),
  );
  if (unused.length !== 1 || !unused[0].includes('strayKey')) {
    failures.push(`unused key: expected one warning naming strayKey, got ${JSON.stringify(unused)}`);
  }

  // Coverage counting: a plural is one key, Polish-only few/many add nothing,
  // an empty string and a missing key are both missing.
  const coverageFixture = [
    'defineCopy({',
    "  en: { title: 'Orders', header: { sub: 'S', count: { one: '{n} order', other: '{n} orders' } }, empty: 'None', days: { one: '{n} day', other: '{n} days' } },",
    "  pl: { title: 'Zamówienia', header: { count: { one: 'a', few: 'b', many: 'c', other: 'd' } }, empty: '', days: { one: 'x' } },",
    '});',
  ].join('\n');
  cases += 1;
  const covered = coverageOf(extractCopies(coverageFixture).copies, 'pl');
  if (covered.total !== 5 || covered.translated !== 2) {
    failures.push(`coverage: expected 2/5 translated, got ${covered.translated}/${covered.total}`);
  }
  cases += 1;
  if (JSON.stringify(covered.missing) !== JSON.stringify(['header.sub', 'empty', 'days'])) {
    failures.push(`coverage: expected missing header.sub, empty, days; got ${JSON.stringify(covered.missing)}`);
  }
  cases += 1;
  const fullEn = coverageOf(extractCopies(coverageFixture).copies, 'en');
  if (fullEn.total !== 5 || fullEn.translated !== 5 || fullEn.missing.length !== 0) {
    failures.push(`coverage: English must be complete against itself, got ${fullEn.translated}/${fullEn.total}`);
  }
  cases += 1;
  const lines = formatReport(
    [
      { label: 'b.copy.ts', copies: extractCopies("defineCopy({ en: { a: 'A', b: 'B' }, pl: { a: 'x' } });").copies, unreadable: 0 },
      { label: 'a.copy.ts', copies: extractCopies(coverageFixture).copies, unreadable: 0 },
    ],
    ['en', 'pl'],
    { listMissing: true },
  );
  const expectedLines = [
    'a.copy.ts   pl 2/5 (40%)',
    '    pl missing: header.sub',
    '    pl missing: empty',
    '    pl missing: days',
    'b.copy.ts   pl 1/2 (50%)',
    '    pl missing: b',
    'TOTAL       pl 3/7 (42%)',
  ];
  if (JSON.stringify(lines) !== JSON.stringify(expectedLines)) {
    failures.push(`report: expected ${JSON.stringify(expectedLines)}, got ${JSON.stringify(lines)}`);
  }
  cases += 1;
  if (storageKeyMirrorErrors().length > 0) failures.push(`storage key mirror: ${storageKeyMirrorErrors()[0]}`);

  if (failures.length > 0) {
    console.error('✗ check-copy-locales --self-check failed:\n');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-copy-locales --self-check: ${cases} cases pass.`);
}

const args = process.argv.slice(2);
if (args.includes('--self-check')) selfCheck();
else if (args.some((a) => ['--report', '--missing', '--verbose'].includes(a))) {
  report(args.includes('--missing') || args.includes('--verbose'));
} else run();
