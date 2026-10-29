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
 * Usage:
 *   node scripts/check-copy-locales.mjs
 *   node scripts/check-copy-locales.mjs --self-check   (proves every rule fires)
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
        const langs = { en: new Map(), pl: new Map() };
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
          `${fileLabel}:${enLeaf.line} en.${key} "${enLeaf.text}" is ${enLeaf.text.length} chars, budget ${enLeaf.budget}.`,
        );
      }
    }
    for (const [key, plLeaf] of pl) {
      const enKey = englishKeyFor(key, en);
      if (enKey === null) continue;
      const enLeaf = en.get(enKey);
      if (placeholderSet(plLeaf.text) !== placeholderSet(enLeaf.text)) {
        errors.push(
          `${fileLabel}:${plLeaf.line} pl.${key} placeholders {${placeholderSet(plLeaf.text)}} do not match en {${placeholderSet(enLeaf.text)}}.`,
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

function run() {
  const files = listSourceFiles(SCAN_ROOT);
  const copyFiles = [];
  const usedWords = new Set();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const parsed = source.includes('defineCopy(') ? extractCopies(source, file) : null;
    if (parsed && (parsed.copies.length > 0 || parsed.problems.length > 0)) {
      copyFiles.push({ file, parsed });
    } else {
      for (const word of source.match(/\w+/g) ?? []) usedWords.add(word);
    }
  }

  const errors = [];
  const warnings = [];
  if (copyFiles.length < MIN_COPY_FILES) {
    errors.push(
      `found ${copyFiles.length} copy file(s) under ${relative(ROOT, SCAN_ROOT)}, expected at least ${MIN_COPY_FILES}. ` +
        'The scan finding nothing is a broken scan, not a clean tree.',
    );
  }
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

  if (failures.length > 0) {
    console.error('✗ check-copy-locales --self-check failed:\n');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-copy-locales --self-check: ${cases} cases pass.`);
}

if (process.argv.includes('--self-check')) selfCheck();
else run();
