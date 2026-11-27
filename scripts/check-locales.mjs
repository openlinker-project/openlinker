#!/usr/bin/env node
/**
 * check-locales
 *
 * Guards the translation files of the admin app (ADR-081, #3859). A namespace
 * has one home and one file per language:
 *
 *   core:    apps/web/src/locales/<lang>/<namespace>.json, one file per
 *            namespace, listed in locales/en/index.ts (and, for Polish, in
 *            locales/pl/index.check.ts); budgets in apps/web/src/locales/limits.json
 *            as "<ns>:<key.path>"
 *   plugins: apps/web/src/plugins/<id>/locales/<lang>.json, one namespace per
 *            plugin, budgets in the plugin's own locales/limits.json as
 *            "<key.path>"
 *
 * English is the base of every namespace. Each translation is checked against
 * its base:
 *
 *   1. Shape: every value is a string or an object of them - no arrays,
 *      numbers or nulls - and English has at least one string.
 *   2. Keys: a translation carries no key English lacks (Polish-only plural
 *      `few` / `many` excepted). tsc enforces this for the core file through
 *      locales/pl/index.check.ts; plugins are only checked here.
 *   3. Placeholders: the same set of `{name}` placeholders as English (plural
 *      `few` / `many` compare against English `other`).
 *   4. Budgets: a key with a limit stays within it in every language - it sits
 *      in a button, nav item, chip or header. A limit naming no English key is
 *      an error, so a renamed key cannot silently lose its budget.
 *   5. No em dash (U+2014); the house style is a plain hyphen.
 *   6. Sorted: keys in alphabetical order at every level, so parallel changes
 *      land in different places. `--fix` rewrites every file sorted.
 *   7. Files: a translation file without its English file, or a language not
 *      in LANGUAGES, is an error; so is a core file missing from its index
 *      (locales/en/index.ts, locales/pl/index.check.ts) or an index entry with
 *      no file.
 *   8. Warning only: Polish more than 1.6x and 15+ characters longer than
 *      English, for a reviewer to look at the layout.
 *   9. Warning only: a key whose name appears in no source file, so it is
 *      probably unused. A heuristic - `title` is always "used" - so it reports
 *      and never fails.
 *  10. Warning only: a key English has and a translation lacks (an empty
 *      string counts as missing; a plural counts once), core and plugins
 *      alike (#3891). It never fails: the runtime already shows the English
 *      text for that key, and English stays the fallback, so a gap is
 *      something to translate, not a broken build.
 *
 * The scan fails when it finds fewer core namespaces than MIN_CORE_NAMESPACES:
 * a walk that finds nothing must not read as "all clean".
 *
 * Not a gate: `--report` prints how far each language is translated, namespace
 * by namespace. A plural counts as ONE key, translated when the language has a
 * non-empty `other`; an empty string counts as missing, as the runtime treats
 * it. It always exits 0.
 *
 * Usage:
 *   node scripts/check-locales.mjs
 *   node scripts/check-locales.mjs --self-check      (proves every rule fires)
 *   node scripts/check-locales.mjs --fix             (sort every file in place)
 *   node scripts/check-locales.mjs --report          (coverage per namespace, most missing first, plus TOTAL)
 *   node scripts/check-locales.mjs --report --missing   (also list the missing key paths)
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WEB_SRC = join(ROOT, 'apps/web/src');
const CORE_DIR = join(WEB_SRC, 'locales');
const PLUGINS_DIR = join(WEB_SRC, 'plugins');
const EM_DASH = '—';
const PLACEHOLDER = /\{(\w+)\}/g;
const PLURAL_KEYS = new Set(['one', 'few', 'many', 'other']);
const BASE = 'en';
const LANGUAGES = ['en', 'pl'];

/** Today: `format` and `ui`. */
const MIN_CORE_NAMESPACES = 2;

// ---------------------------------------------------------------------------
// Pure rules (exercised by --self-check)
// ---------------------------------------------------------------------------

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Leaf strings by dotted path; shape problems go to `problems`. */
export function leaves(tree, problems = [], path = '') {
  const out = new Map();
  if (!isObject(tree)) {
    problems.push(`${path || '(root)'} is not an object`);
    return out;
  }
  for (const [key, value] of Object.entries(tree)) {
    const full = path ? `${path}.${key}` : key;
    if (typeof value === 'string') out.set(full, value);
    else if (isObject(value)) for (const [k, v] of leaves(value, problems, full)) out.set(k, v);
    else problems.push(`${full} is ${Array.isArray(value) ? 'an array' : typeof value}; use a string or an object`);
  }
  return out;
}

const placeholdersOf = (text) => [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort().join(',');

/** The English key a translated key is compared against. */
function englishCounterpart(key, en) {
  if (en.has(key)) return key;
  const dot = key.lastIndexOf('.');
  const last = key.slice(dot + 1);
  if (dot > 0 && (last === 'few' || last === 'many') && en.has(`${key.slice(0, dot)}.other`)) {
    return `${key.slice(0, dot)}.other`;
  }
  return null;
}

/** First path whose keys are not in alphabetical order, or null. */
export function unsortedPath(tree, path = '') {
  if (!isObject(tree)) return null;
  const keys = Object.keys(tree);
  const sorted = [...keys].sort();
  if (keys.some((k, i) => k !== sorted[i])) return path || '(root)';
  for (const key of keys) {
    const inner = unsortedPath(tree[key], path ? `${path}.${key}` : key);
    if (inner) return inner;
  }
  return null;
}

export function sortTree(tree) {
  if (!isObject(tree)) return tree;
  return Object.fromEntries(Object.keys(tree).sort().map((k) => [k, sortTree(tree[k])]));
}

/**
 * Check one namespace. `files` maps a language to its parsed tree (absent
 * when the language has no file); `limits` maps a key path to a budget.
 */
export function checkNamespace({ label, files, limits = {} }) {
  const errors = [];
  const warnings = [];
  const shape = [];
  const en = leaves(files[BASE], shape);
  for (const p of shape) errors.push(`${label} [${BASE}] ${p}`);
  if (en.size === 0) errors.push(`${label} has no English text; English is the base every language falls back to.`);

  for (const [key, budget] of Object.entries(limits)) {
    if (!en.has(key) && !en.has(`${key}.other`)) errors.push(`${label} limit "${key}" names no English key; move or drop the budget.`);
    else if (!Number.isInteger(budget) || budget <= 0) errors.push(`${label} limit "${key}" must be a positive integer.`);
  }

  for (const language of LANGUAGES) {
    const tree = files[language];
    if (tree === undefined) continue;
    const langShape = [];
    const own = language === BASE ? en : leaves(tree, langShape);
    for (const p of langShape) errors.push(`${label} [${language}] ${p}`);
    const unsorted = unsortedPath(tree);
    if (unsorted) errors.push(`${label} [${language}] keys under ${unsorted} are not sorted; run pnpm i18n:sort.`);

    for (const [key, text] of own) {
      if (text.includes(EM_DASH)) errors.push(`${label} [${language}] ${key} uses an em dash; use a plain hyphen.`);
      const budget = limits[unitOf(key)] ?? limits[key];
      if (Number.isInteger(budget) && text.length > budget) {
        errors.push(`${label} [${language}] ${key} "${text}" is ${text.length} chars, budget ${budget}. Shorten it or raise the budget.`);
      }
      if (language === BASE) continue;
      const counterpart = englishCounterpart(key, en);
      if (counterpart === null) {
        errors.push(`${label} [${language}] ${key} is not in English; a translation cannot add keys.`);
        continue;
      }
      const source = en.get(counterpart);
      if (text !== '' && placeholdersOf(text) !== placeholdersOf(source)) {
        errors.push(
          `${label} [${language}] ${key} uses placeholders {${placeholdersOf(text)}}, English uses {${placeholdersOf(source)}}.`,
        );
      }
      if (text.length > source.length * 1.6 && text.length - source.length >= 15) {
        warnings.push(`${label} [${language}] ${key} is ${(text.length / source.length).toFixed(1)}x longer than English (+${text.length - source.length} chars).`);
      }
    }
  }
  return { errors, warnings };
}

/** The unit a key counts as: a plural's parent path, or the key itself. */
function unitOf(key) {
  const dot = key.lastIndexOf('.');
  return dot > 0 && PLURAL_KEYS.has(key.slice(dot + 1)) ? key.slice(0, dot) : key;
}

/** The name a component reads a key by: the last segment, or a plural's parent. */
function readName(key) {
  const unit = unitOf(key);
  return unit.slice(unit.lastIndexOf('.') + 1);
}

export function findUnusedKeys({ label, files }, usedWords) {
  const reported = new Set();
  const warnings = [];
  for (const key of leaves(files[BASE]).keys()) {
    const unit = unitOf(key);
    if (reported.has(unit) || usedWords.has(readName(key))) continue;
    reported.add(unit);
    warnings.push(`${label} ${unit} looks unused: "${readName(key)}" appears in no source file.`);
  }
  return warnings;
}

/**
 * One warning per English key a translation lacks, for every language other
 * than the base. A namespace with no file for a language lacks every key.
 */
export function findMissingTranslations({ label, files }) {
  const warnings = [];
  for (const language of LANGUAGES) {
    if (language === BASE) continue;
    for (const unit of coverageOf(files, language).missing) {
      warnings.push(`${label} [${language}] ${unit} is not translated; English is shown.`);
    }
  }
  return warnings;
}

/**
 * How much of English one language has translated. A plural group is one
 * unit (translated when `<unit>.other` is non-empty), any other leaf is one.
 */
export function coverageOf(files, language) {
  const en = leaves(files[BASE]);
  const own = files[language] === undefined ? new Map() : leaves(files[language]);
  const units = new Map();
  for (const key of en.keys()) {
    const unit = unitOf(key);
    units.set(unit, unit === key ? key : `${unit}.other`);
  }
  let translated = 0;
  const missing = [];
  for (const [unit, probe] of units) {
    if ((own.get(probe) ?? '') !== '') translated += 1;
    else missing.push(unit);
  }
  return { total: units.size, translated, missing };
}

const percent = (translated, total) => (total === 0 ? '-' : `${Math.floor((translated / total) * 100)}%`);

/** @returns {string[]} report lines for the languages other than English. */
export function formatReport(namespaces, languages, { listMissing = false } = {}) {
  const targets = languages.filter((l) => l !== BASE);
  const rows = namespaces.map(({ label, files }) => {
    const per = targets.map((language) => ({ language, ...coverageOf(files, language) }));
    return { label, per, missingCount: per.reduce((sum, c) => sum + c.missing.length, 0) };
  });
  rows.sort((a, b) => b.missingCount - a.missingCount || a.label.localeCompare(b.label));
  const width = Math.max(5, ...rows.map((r) => r.label.length));
  const lines = [];
  for (const row of rows) {
    lines.push(`${row.label.padEnd(width)}   ${row.per.map((c) => `${c.language} ${c.translated}/${c.total} (${percent(c.translated, c.total)})`).join('   ')}`);
    if (listMissing) for (const c of row.per) for (const key of c.missing) lines.push(`    ${c.language} missing: ${key}`);
  }
  const totals = targets.map((language) => {
    let total = 0;
    let translated = 0;
    for (const { files } of namespaces) {
      const c = coverageOf(files, language);
      total += c.total;
      translated += c.translated;
    }
    return `${language} ${translated}/${total} (${percent(translated, total)})`;
  });
  lines.push(`${'TOTAL'.padEnd(width)}   ${totals.join('   ')}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const rel = (file) => relative(ROOT, file);

/**
 * The JSON files a core index imports must be exactly the files on disk: a
 * file missing from the index is copy nothing can read, an import with no file
 * fails the build.
 */
function indexErrors(indexFile, namespaces) {
  if (!existsSync(indexFile)) {
    return namespaces.length > 0 ? [`${rel(indexFile)} is missing.`] : [];
  }
  const source = readFileSync(indexFile, 'utf8');
  const imported = new Set([...source.matchAll(/from '\.\/([a-z][a-z0-9-]*)\.json'/g)].map((m) => m[1]));
  const errors = [];
  for (const ns of namespaces) {
    if (!imported.has(ns)) errors.push(`${rel(indexFile)} does not import ./${ns}.json.`);
  }
  for (const ns of imported) {
    if (!namespaces.includes(ns)) errors.push(`${rel(indexFile)} imports ./${ns}.json, which does not exist.`);
  }
  return errors;
}

/**
 * Every namespace with the files it lives in. Errors for files that do not
 * fit the layout go to `layoutErrors`.
 */
function discover(layoutErrors) {
  const namespaces = [];
  const fileSets = [];

  // Core: one folder per language, one file per namespace.
  const coreFiles = {};
  for (const entry of readdirSync(CORE_DIR)) {
    const dir = join(CORE_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    if (!LANGUAGES.includes(entry)) {
      layoutErrors.push(`${rel(dir)}: "${entry}" is not in LANGUAGES.`);
      continue;
    }
    coreFiles[entry] = {};
    for (const file of readdirSync(dir)) {
      const match = file.match(/^([a-z][a-z0-9-]*)\.json$/);
      if (match) coreFiles[entry][match[1]] = join(dir, file);
    }
  }
  if (!coreFiles[BASE] || Object.keys(coreFiles[BASE]).length === 0) {
    layoutErrors.push(`${rel(CORE_DIR)}/${BASE} has no namespace files.`);
  } else {
    for (const [language, byNs] of Object.entries(coreFiles)) {
      for (const ns of Object.keys(byNs)) {
        if (!(ns in coreFiles[BASE])) layoutErrors.push(`${rel(byNs[ns])}: namespace "${ns}" has no ${BASE}/${ns}.json.`);
      }
    }
    layoutErrors.push(
      ...indexErrors(join(CORE_DIR, BASE, 'index.ts'), Object.keys(coreFiles[BASE])),
      ...indexErrors(join(CORE_DIR, 'pl', 'index.check.ts'), Object.keys(coreFiles.pl ?? {})),
    );
    const limitsFile = join(CORE_DIR, 'limits.json');
    const allLimits = existsSync(limitsFile) ? readJson(limitsFile) : {};
    for (const key of Object.keys(allLimits)) {
      const ns = key.split(':')[0];
      if (!key.includes(':') || !(ns in coreFiles[BASE])) {
        layoutErrors.push(`${rel(limitsFile)} "${key}" must be "<namespace>:<key.path>" with a core namespace.`);
      }
    }
    for (const ns of Object.keys(coreFiles[BASE]).sort()) {
      const paths = Object.fromEntries(
        Object.entries(coreFiles).filter(([, byNs]) => byNs[ns]).map(([l, byNs]) => [l, byNs[ns]]),
      );
      const files = Object.fromEntries(Object.entries(paths).map(([l, f]) => [l, readJson(f)]));
      fileSets.push({ files: paths, trees: files });
      const limits = Object.fromEntries(
        Object.entries(allLimits).filter(([k]) => k.startsWith(`${ns}:`)).map(([k, v]) => [k.slice(ns.length + 1), v]),
      );
      namespaces.push({ label: `core:${ns}`, files, limits });
    }
  }

  // Plugins: one namespace each, one file per language.
  for (const id of readdirSync(PLUGINS_DIR)) {
    const dir = join(PLUGINS_DIR, id, 'locales');
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const files = {};
    let limits = {};
    for (const entry of readdirSync(dir)) {
      if (entry === 'limits.json') limits = readJson(join(dir, entry));
      else if (/^[a-z]{2}\.json$/.test(entry)) {
        const language = entry.slice(0, 2);
        if (!LANGUAGES.includes(language)) layoutErrors.push(`${rel(join(dir, entry))}: "${language}" is not in LANGUAGES.`);
        else files[language] = join(dir, entry);
      }
    }
    if (!files[BASE]) {
      layoutErrors.push(`${rel(dir)} has translations but no ${BASE}.json.`);
      continue;
    }
    const trees = Object.fromEntries(Object.entries(files).map(([l, f]) => [l, readJson(f)]));
    fileSets.push({ files, trees });
    namespaces.push({ label: `plugin:${id}`, files: trees, limits });
  }
  return { namespaces, fileSets };
}

function listSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function usedWords() {
  const words = new Set();
  for (const file of listSourceFiles(WEB_SRC)) {
    for (const word of readFileSync(file, 'utf8').match(/\w+/g) ?? []) words.add(word);
  }
  return words;
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
// Commands
// ---------------------------------------------------------------------------

function run() {
  const errors = [];
  const warnings = [];
  const { namespaces } = discover(errors);
  const coreCount = namespaces.filter((n) => n.label.startsWith('core:')).length;
  if (coreCount < MIN_CORE_NAMESPACES) {
    errors.push(
      `found ${coreCount} core namespace(s) in ${rel(CORE_DIR)}/${BASE}/, expected at least ${MIN_CORE_NAMESPACES}. ` +
        'The scan finding nothing is a broken scan, not a clean tree.',
    );
  }
  errors.push(...storageKeyMirrorErrors());
  const words = usedWords();
  for (const namespace of namespaces) {
    const result = checkNamespace(namespace);
    errors.push(...result.errors);
    warnings.push(...result.warnings, ...findUnusedKeys(namespace, words), ...findMissingTranslations(namespace));
  }
  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (errors.length > 0) {
    console.error(`✗ check-locales: ${errors.length} problem(s)\n`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`✓ check-locales: ${namespaces.length} namespace(s) checked, ${warnings.length} warning(s).`);
}

function fix() {
  const { fileSets } = discover([]);
  let rewritten = 0;
  for (const { files, trees } of fileSets) {
    for (const [language, file] of Object.entries(files)) {
      if (unsortedPath(trees[language]) === null) continue;
      writeFileSync(file, `${JSON.stringify(sortTree(trees[language]), null, 2)}\n`);
      rewritten += 1;
    }
  }
  for (const file of [join(CORE_DIR, 'limits.json')]) {
    if (!existsSync(file)) continue;
    const tree = readJson(file);
    if (unsortedPath(tree) === null) continue;
    writeFileSync(file, `${JSON.stringify(sortTree(tree), null, 2)}\n`);
    rewritten += 1;
  }
  console.log(`✓ check-locales --fix: ${rewritten} file(s) sorted.`);
}

function report(listMissing) {
  const { namespaces } = discover([]);
  for (const line of formatReport(namespaces, LANGUAGES, { listMissing })) console.log(line);
}

function selfCheck() {
  const failures = [];
  let cases = 0;
  const expectError = (name, namespace, fragment) => {
    cases += 1;
    const { errors } = checkNamespace({ label: 'fixture', ...namespace });
    if (!errors.some((e) => e.includes(fragment))) failures.push(`${name}: expected an error containing "${fragment}", got ${JSON.stringify(errors)}`);
  };
  const expectClean = (name, namespace) => {
    cases += 1;
    const { errors } = checkNamespace({ label: 'fixture', ...namespace });
    if (errors.length > 0) failures.push(`${name}: expected no errors, got ${JSON.stringify(errors)}`);
  };
  const expectWarning = (name, namespace, fragment) => {
    cases += 1;
    const { warnings } = checkNamespace({ label: 'fixture', ...namespace });
    if (!warnings.some((w) => w.includes(fragment))) failures.push(`${name}: expected a warning containing "${fragment}", got ${JSON.stringify(warnings)}`);
  };

  expectError('placeholder mismatch', { files: { en: { a: 'Hi {name}' }, pl: { a: 'Cześć {imie}' } } }, 'placeholders');
  expectError('key English lacks', { files: { en: { a: 'A' }, pl: { a: 'A', b: 'B' } } }, 'not in English');
  expectError(
    'Polish budget overflow',
    { files: { en: { b: 'Create shipment' }, pl: { b: 'Utwórz nową przesyłkę kurierską' } }, limits: { b: 15 } },
    'budget 15',
  );
  expectError('English budget overflow', { files: { en: { b: 'Create shipment' } }, limits: { b: 5 } }, '[en] b');
  expectError('limit on a missing key', { files: { en: { b: 'B' } }, limits: { c: 5 } }, 'names no English key');
  expectError('em dash', { files: { en: { c: 'Demo — read-only' } } }, 'em dash');
  expectError('unsorted keys', { files: { en: { b: 'B', a: 'A' } } }, 'not sorted');
  expectError('unsorted nested keys', { files: { en: { a: { z: 'Z', y: 'Y' } } } }, 'under a are not sorted');
  expectError('array value', { files: { en: { a: ['x'] } } }, 'an array');
  expectError('number value', { files: { en: { a: 3 } } }, 'number');
  expectError('no English text', { files: { en: {} } }, 'no English text');

  expectClean('plural forms compare to other', {
    files: {
      en: { n: { one: '{n} order', other: '{n} orders' } },
      pl: { n: { few: '{n} zamówienia', many: '{n} zamówień', one: '{n} zamówienie', other: '{n} zamówienia' } },
    },
    limits: { n: 20 },
  });
  expectClean('partial Polish', { files: { en: { a: 'Orders', b: 'More' }, pl: { a: 'Zamówienia' } } });
  expectClean('a placeholder used twice', { files: { en: { a: '{n} of {n}' }, pl: { a: '{n} z {n}' } } });
  expectClean('empty Polish is a gap, not a mismatch', { files: { en: { a: 'Hi {name}' }, pl: { a: '' } } });

  expectWarning('length warning', { files: { en: { a: 'Save' }, pl: { a: 'Zapisz wszystkie zmiany teraz' } } }, 'longer than English');

  cases += 1;
  const unused = findUnusedKeys({ label: 'fixture', files: { en: { strayKey: { one: 'x', other: 'y' }, usedKey: 'A' } } }, new Set(['usedKey']));
  if (unused.length !== 1 || !unused[0].includes('strayKey')) failures.push(`unused key: expected one warning naming strayKey, got ${JSON.stringify(unused)}`);

  cases += 1;
  const untranslated = findMissingTranslations({
    label: 'fixture',
    files: { en: { a: 'A', b: 'B', c: 'C', n: { one: '{n} x', other: '{n} xs' } }, pl: { a: 'A', b: '', n: { one: 'a', few: 'b', many: 'c', other: 'd' } } },
  });
  const expectedUntranslated = ['fixture [pl] b is not translated; English is shown.', 'fixture [pl] c is not translated; English is shown.'];
  if (JSON.stringify(untranslated) !== JSON.stringify(expectedUntranslated)) {
    failures.push(`missing translation: expected ${JSON.stringify(expectedUntranslated)}, got ${JSON.stringify(untranslated)}`);
  }
  cases += 1;
  const noPolishFile = findMissingTranslations({ label: 'fixture', files: { en: { a: 'A' } } });
  if (noPolishFile.length !== 1) failures.push(`missing translation without a Polish file: expected one warning, got ${JSON.stringify(noPolishFile)}`);

  cases += 1;
  const sorted = JSON.stringify(sortTree({ b: { d: '1', c: '2' }, a: '3' }));
  if (sorted !== '{"a":"3","b":{"c":"2","d":"1"}}') failures.push(`sortTree: got ${sorted}`);

  const coverageFiles = {
    en: { days: { one: '{n} day', other: '{n} days' }, empty: 'None', header: { count: { one: '{n} order', other: '{n} orders' }, sub: 'S' }, title: 'Orders' },
    pl: { days: { one: 'x' }, empty: '', header: { count: { few: 'b', many: 'c', one: 'a', other: 'd' } }, title: 'Zamówienia' },
  };
  cases += 1;
  const covered = coverageOf(coverageFiles, 'pl');
  if (covered.total !== 5 || covered.translated !== 2) failures.push(`coverage: expected 2/5 translated, got ${covered.translated}/${covered.total}`);
  cases += 1;
  if (JSON.stringify(covered.missing) !== JSON.stringify(['days', 'empty', 'header.sub'])) {
    failures.push(`coverage: expected missing days, empty, header.sub; got ${JSON.stringify(covered.missing)}`);
  }
  cases += 1;
  const lines = formatReport(
    [
      { label: 'core:b', files: { en: { a: 'A', b: 'B' }, pl: { a: 'x' } } },
      { label: 'core:a', files: coverageFiles },
    ],
    ['en', 'pl'],
    { listMissing: true },
  );
  const expectedLines = [
    'core:a   pl 2/5 (40%)',
    '    pl missing: days',
    '    pl missing: empty',
    '    pl missing: header.sub',
    'core:b   pl 1/2 (50%)',
    '    pl missing: b',
    'TOTAL    pl 3/7 (42%)',
  ];
  if (JSON.stringify(lines) !== JSON.stringify(expectedLines)) failures.push(`report: expected ${JSON.stringify(expectedLines)}, got ${JSON.stringify(lines)}`);
  cases += 1;
  if (storageKeyMirrorErrors().length > 0) failures.push(`storage key mirror: ${storageKeyMirrorErrors()[0]}`);

  if (failures.length > 0) {
    console.error('✗ check-locales --self-check failed:\n');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-locales --self-check: ${cases} cases pass.`);
}

const args = process.argv.slice(2);
if (args.includes('--self-check')) selfCheck();
else if (args.includes('--fix')) fix();
else if (args.some((a) => ['--report', '--missing', '--verbose'].includes(a))) report(args.includes('--missing') || args.includes('--verbose'));
else run();
