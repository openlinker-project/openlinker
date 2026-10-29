#!/usr/bin/env node
/**
 * check-copy-locales
 *
 * Guards the typed copy files of the admin app (ADR-079, #3859). Every
 * `defineCopy({ en, pl })` call in an `apps/web/src/**\/*.copy.ts` file is
 * read through the TypeScript AST and checked:
 *
 *   1. Placeholders: a Polish string uses exactly the `{name}` placeholders of
 *      its English key (plural `few` / `many` compare against English
 *      `other`). A missing or misspelt placeholder renders as raw text.
 *   2. Budgets: a key written `fit(n, 'text')` must stay within n characters
 *      in every language - it sits in a button, nav item, chip or header.
 *   3. No em dash (U+2014) in copy; the house style is a plain hyphen.
 *   4. Warning only: Polish more than 1.6x and 15+ characters longer than
 *      English, for a reviewer to look at the layout.
 *
 * TypeScript already rejects a Polish key English lacks, so key parity is not
 * repeated here. Copy files not yet migrated to `defineCopy` are skipped.
 *
 * Usage:
 *   node scripts/check-copy-locales.mjs
 *   node scripts/check-copy-locales.mjs --self-check
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

// ---------------------------------------------------------------------------
// Pure parsing (exported shape is exercised by --self-check)
// ---------------------------------------------------------------------------

function readLeaf(node, sf) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { text: node.text, budget: null, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 };
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'fit' &&
    node.arguments.length === 2 &&
    ts.isNumericLiteral(node.arguments[0])
  ) {
    const inner = readLeaf(node.arguments[1], sf);
    if (inner) return { ...inner, budget: Number(node.arguments[0].text) };
  }
  return null;
}

function walk(node, sf, path, out) {
  if (!ts.isObjectLiteralExpression(node)) return;
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (name === null) continue;
    const key = path ? `${path}.${name}` : name;
    const leaf = readLeaf(prop.initializer, sf);
    if (leaf) out.set(key, leaf);
    else walk(prop.initializer, sf, key, out);
  }
}

/** Returns one `{ en, pl }` pair of leaf maps per `defineCopy` call. */
export function extractCopies(source, fileName = 'copy.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const copies = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineCopy' &&
      node.arguments.length === 1 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const langs = { en: new Map(), pl: new Map() };
      for (const prop of node.arguments[0].properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text in langs) {
          walk(prop.initializer, sf, '', langs[prop.name.text]);
        }
      }
      copies.push(langs);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return copies;
}

function placeholders(text) {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(',');
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

export function checkCopies(copies, fileLabel) {
  const errors = [];
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
      if (placeholders(plLeaf.text) !== placeholders(enLeaf.text)) {
        errors.push(
          `${fileLabel}:${plLeaf.line} pl.${key} placeholders {${placeholders(plLeaf.text)}} do not match en {${placeholders(enLeaf.text)}}.`,
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

// ---------------------------------------------------------------------------
// Filesystem scan
// ---------------------------------------------------------------------------

function listCopyFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listCopyFiles(full, out);
    else if (entry.endsWith('.copy.ts')) out.push(full);
  }
  return out;
}

function run() {
  const files = listCopyFiles(SCAN_ROOT);
  let checked = 0;
  const errors = [];
  const warnings = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('defineCopy(')) continue;
    const copies = extractCopies(source, file);
    if (copies.length === 0) continue;
    checked += 1;
    const result = checkCopies(copies, relative(ROOT, file));
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (errors.length > 0) {
    console.error(`✗ check-copy-locales: ${errors.length} problem(s)\n`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`✓ check-copy-locales: ${checked} copy file(s) checked, ${warnings.length} length warning(s).`);
}

// ---------------------------------------------------------------------------
// --self-check
// ---------------------------------------------------------------------------

function selfCheck() {
  const failures = [];
  const expectProblem = (name, source, fragment) => {
    const { errors } = checkCopies(extractCopies(source), 'fixture.copy.ts');
    if (!errors.some((e) => e.includes(fragment))) {
      failures.push(`${name}: expected an error containing "${fragment}", got ${JSON.stringify(errors)}`);
    }
  };
  const expectClean = (name, source) => {
    const { errors } = checkCopies(extractCopies(source), 'fixture.copy.ts');
    if (errors.length > 0) failures.push(`${name}: expected no errors, got ${JSON.stringify(errors)}`);
  };

  expectProblem(
    'placeholder mismatch',
    "defineCopy({ en: { a: 'Hi {name}' }, pl: { a: 'Cześć {imie}' } });",
    'placeholders',
  );
  expectProblem(
    'budget overflow',
    "defineCopy({ en: { b: fit(15, 'Create shipment') }, pl: { b: 'Utwórz nową przesyłkę kurierską' } });",
    'budget 15',
  );
  expectProblem('em dash', "defineCopy({ en: { c: 'Demo — read-only' }, pl: {} });", 'em dash');
  expectClean(
    'plural forms compare to other',
    "defineCopy({ en: { n: { one: '{n} order', other: '{n} orders' } }, pl: { n: { one: '{n} zamówienie', few: '{n} zamówienia', many: '{n} zamówień', other: '{n} zamówienia' } } });",
  );
  expectClean('partial Polish', "defineCopy({ en: { a: 'Orders', b: 'More' }, pl: { a: 'Zamówienia' } });");

  if (failures.length > 0) {
    console.error('✗ check-copy-locales --self-check failed:\n');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('✓ check-copy-locales --self-check: 5 cases pass.');
}

if (process.argv.includes('--self-check')) selfCheck();
else run();
