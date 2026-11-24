#!/usr/bin/env node
/**
 * check-i18n-lint-rule
 *
 * Proves the no-hardcoded-text rules (ADR-081, #3859) are in force where they
 * are meant to be, not just that their options are well formed. Three things
 * can switch the rule off while `pnpm lint` stays green, and each is checked:
 *
 *   1. A typo or an empty glob in the override's `files`, or a scope that
 *      shrank. Every glob must match at least one real file, the scope and the
 *      exclusions must equal EXPECTED_SCOPE / EXPECTED_EXCLUDED, and the rule
 *      must be on for a real component in each of `app`, `features`, `pages`,
 *      `plugins` and `shared`, resolved through the real config.
 *   2. A later override turning the rule off. The rules are taken from
 *      `calculateConfigForFile` for that real path, so the FINAL resolved
 *      config is what gets exercised.
 *   3. An over-broad `words.exclude` entry that matches the empty string.
 *      Fixtures lint with the resolved options: a sentence, a string in a
 *      `{...}` child, a ternary label and a template in a child must be
 *      reported, and copy read from a copy file or a bare glyph must not.
 *
 * It also asserts the rule is OFF for a test file and a `*.copy.ts` file. The
 * third exclusion, the developer-only `pages/dev-ui` route, is pinned by
 * EXPECTED_EXCLUDED.
 *
 * Usage: node scripts/check-i18n-lint-rule.mjs
 */
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { ESLint } = require('eslint');
const { Minimatch } = require(require.resolve('minimatch', { paths: [require.resolve('eslint')] }));
const config = require(join(ROOT, '.eslintrc.js'));

const LITERAL_RULE = 'i18next/no-literal-string';
const SYNTAX_RULE = 'no-restricted-syntax';
const failures = [];
const fail = (message) => failures.push(message);
const globs = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const override = config.overrides.find((o) => (o.plugins ?? []).includes('i18next'));
if (!override) {
  console.error('✗ check-i18n-lint-rule: no override in .eslintrc.js enables the i18next plugin.');
  process.exit(1);
}

// The folders the rule covers: every folder since #3891. Narrowing it is a
// deliberate act: edit this list in the same PR as the override's `files`, so a
// glob that shrinks by accident fails here instead of passing.
const EXPECTED_SCOPE = [
  'apps/web/src/app/**/*.tsx',
  'apps/web/src/features/**/*.tsx',
  'apps/web/src/pages/**/*.tsx',
  'apps/web/src/plugins/**/*.tsx',
  'apps/web/src/shared/**/*.tsx',
];
// The only files left out: tests, copy files and the developer-only `/dev/ui`
// route. A new entry here is a folder that operators read and nobody checks.
const EXPECTED_EXCLUDED = ['**/*.test.tsx', '**/*.copy.ts', 'apps/web/src/pages/dev-ui/**'];
const actualScope = globs(override.files);
if (JSON.stringify([...actualScope].sort()) !== JSON.stringify([...EXPECTED_SCOPE].sort())) {
  fail(
    `the override's files are ${JSON.stringify(actualScope)} but EXPECTED_SCOPE is ` +
      `${JSON.stringify(EXPECTED_SCOPE)}; update both together`
  );
}
const actualExcluded = globs(override.excludedFiles);
if (JSON.stringify([...actualExcluded].sort()) !== JSON.stringify([...EXPECTED_EXCLUDED].sort())) {
  fail(
    `the override's excludedFiles are ${JSON.stringify(actualExcluded)} but EXPECTED_EXCLUDED is ` +
      `${JSON.stringify(EXPECTED_EXCLUDED)}; excluding a folder operators read needs a reason in both places`
  );
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full).split('\\').join('/'));
  }
  return out;
}
const webFiles = walk(join(ROOT, 'apps', 'web', 'src'));

// 1. Every `files` glob must match something, and `excludedFiles` must too.
for (const key of ['files', 'excludedFiles']) {
  for (const glob of globs(override[key])) {
    const matcher = new Minimatch(glob, { matchBase: !glob.includes('/') });
    if (!webFiles.some((file) => matcher.match(file))) {
      fail(`${key} glob "${glob}" matches no file under apps/web/src (a typo switches the rule off)`);
    }
  }
}

const eslint = new ESLint({ cwd: ROOT });
const realFile = webFiles.find((f) => /^apps\/web\/src\/shared\/ui\/[^/]+\.tsx$/.test(f) && !f.endsWith('.test.tsx'));
const testFile = webFiles.find((f) => /^apps\/web\/src\/shared\/ui\/[^/]+\.test\.tsx$/.test(f));
const copyFile = webFiles.find((f) => /^apps\/web\/src\/shared\/ui\/[^/]+\.copy\.ts$/.test(f));
for (const [label, file] of [['a shared/ui component', realFile], ['a shared/ui test', testFile], ['a shared/ui copy file', copyFile]]) {
  if (!file) fail(`found no real file to stand in for ${label}`);
}

const severityOf = (entry) => (Array.isArray(entry) ? entry[0] : entry);
const isOn = (entry) => entry !== undefined && ['error', 2, 'warn', 1].includes(severityOf(entry));

let resolved = null;
if (realFile && testFile && copyFile) {
  resolved = await eslint.calculateConfigForFile(join(ROOT, realFile));
  if (!isOn(resolved.rules?.[LITERAL_RULE])) {
    fail(`${LITERAL_RULE} is not enabled for ${realFile} in the resolved config`);
  }
  const syntax = resolved.rules?.[SYNTAX_RULE];
  const selectors = Array.isArray(syntax) ? syntax.slice(1).map((o) => o.selector ?? '') : [];
  if (!isOn(syntax) || !selectors.some((s) => s.includes('JSXExpressionContainer'))) {
    fail(`${SYNTAX_RULE} no longer carries the JSX-child selectors for ${realFile}`);
  }
  for (const [label, file] of [['test file', testFile], ['copy file', copyFile]]) {
    const other = await eslint.calculateConfigForFile(join(ROOT, file));
    if (isOn(other.rules?.[LITERAL_RULE])) fail(`${LITERAL_RULE} should be off for a ${label} (${file})`);
  }
}

// The rule is on in every top-level folder operators read, not only in
// shared/ui: one real component from each, resolved through the real config.
for (const folder of ['app', 'features', 'pages', 'plugins', 'shared']) {
  const prefix = `apps/web/src/${folder}/`;
  const sample = webFiles.find(
    (f) => f.startsWith(prefix) && f.endsWith('.tsx') && !f.endsWith('.test.tsx') && !f.startsWith('apps/web/src/pages/dev-ui/'),
  );
  if (!sample) {
    fail(`found no real component under ${prefix} to check`);
    continue;
  }
  const config = await eslint.calculateConfigForFile(join(ROOT, sample));
  if (!isOn(config.rules?.[LITERAL_RULE])) fail(`${LITERAL_RULE} is not enabled for ${sample}`);
}

// 2 + 3. Behaviour, with the options resolved for the real path.
const fixtures = [
  { name: 'a hard-coded sentence', rule: LITERAL_RULE, fires: true,
    code: 'export function SaveBar(): JSX.Element {\n  return <p>Save changes</p>;\n}' },
  { name: 'a hard-coded sentence in an arrow component', rule: LITERAL_RULE, fires: true,
    code: 'export const SaveHint = (): JSX.Element => <p>Save changes</p>;' },
  { name: 'a string literal inside braces', rule: SYNTAX_RULE, fires: true,
    code: "export const SaveHint = (): JSX.Element => <p>{'Save changes'}</p>;" },
  { name: 'a ternary label', rule: SYNTAX_RULE, fires: true,
    code: "export const Toggle = ({ open }: { open: boolean }): JSX.Element => <p>{open ? 'Hide details' : 'Show details'}</p>;" },
  { name: 'a template literal child', rule: SYNTAX_RULE, fires: true,
    code: 'export const Count = ({ n }: { n: number }): JSX.Element => <p>{`Showing ${n} rows`}</p>;' },
  { name: 'copy from a copy file', rule: LITERAL_RULE, fires: false,
    code: 'export const SaveLabel = (): JSX.Element => <p>{copy.save}</p>;' },
  { name: 'a bare glyph', rule: LITERAL_RULE, fires: false,
    code: 'export const Ellipsis = (): JSX.Element => <span>…</span>;' },
  { name: 'a glyph ternary', rule: SYNTAX_RULE, fires: false,
    code: "export const Caret = ({ open }: { open: boolean }): JSX.Element => <span>{open ? '▾' : '▸'}</span>;" },
];

if (resolved && isOn(resolved.rules?.[LITERAL_RULE]) && isOn(resolved.rules?.[SYNTAX_RULE])) {
  const linter = new ESLint({
    cwd: ROOT,
    useEslintrc: false,
    baseConfig: {
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      plugins: ['i18next'],
      rules: {
        [LITERAL_RULE]: resolved.rules[LITERAL_RULE],
        [SYNTAX_RULE]: resolved.rules[SYNTAX_RULE],
      },
    },
  });
  for (const fixture of fixtures) {
    const [result] = await linter.lintText(fixture.code, { filePath: join(ROOT, 'fixture.tsx') });
    const fatal = result.messages.find((m) => m.fatal);
    if (fatal) {
      fail(`${fixture.name}: could not parse (${fatal.message})`);
      continue;
    }
    const fired = result.messages.some((m) => m.ruleId === fixture.rule);
    if (fired !== fixture.fires) {
      fail(`${fixture.name}: expected ${fixture.rule} to ${fixture.fires ? 'fire' : 'stay quiet'}, it did not`);
    }
  }
}

// 4. The API error guard (#3867, API_ERROR_MESSAGE_SYNTAX). It rides in the
// same rule, so a later override that replaces no-restricted-syntax silences it
// exactly as it would the JSX-child selectors. Checked on a real .ts and .tsx in
// every folder it covers, then on fixtures through the resolved options.
const isApiMessageSelector = (s) => s.includes("property.name='message'");
let apiSyntax = null;
for (const folder of ['app', 'features', 'pages', 'plugins', 'shared/ui']) {
  for (const ext of ['.tsx', '.ts']) {
    const prefix = `apps/web/src/${folder}/`;
    const sample = webFiles.find(
      (f) =>
        f.startsWith(prefix) &&
        f.endsWith(ext) &&
        !/\.(test|copy)\.tsx?$/.test(f) &&
        !f.endsWith('.d.ts') &&
        !f.startsWith('apps/web/src/pages/dev-ui/'),
    );
    if (!sample) continue;
    const config = await eslint.calculateConfigForFile(join(ROOT, sample));
    const syntax = config.rules?.[SYNTAX_RULE];
    const selectors = Array.isArray(syntax) ? syntax.slice(1).map((o) => o.selector ?? '') : [];
    if (!isOn(syntax) || selectors.filter(isApiMessageSelector).length < 2) {
      fail(`the API error guard (API_ERROR_MESSAGE_SYNTAX) is not active for ${sample}`);
    } else if (apiSyntax === null) {
      apiSyntax = syntax;
    }
  }
}
const apiFixtures = [
  { name: 'a query error message', fires: true, code: 'export const f = (query: { error: Error }): string => query.error.message;' },
  { name: 'a caught error message', fires: true, code: 'export const f = (error: Error): string => error.message;' },
  { name: 'a named error message', fires: true, code: 'export const f = (saveError: Error): string => saveError.message;' },
  { name: 'a copy object', fires: false, code: 'export const f = (copy: { error: { message: string } }): string => copy.error.message;' },
  { name: 'a form field error', fires: false, code: 'export const f = (fieldError: { message: string }): string => fieldError.message;' },
  { name: 'a field state error', fires: false, code: 'export const f = (fieldState: { error: { message: string } }): string => fieldState.error.message;' },
];
if (apiSyntax !== null) {
  const linter = new ESLint({
    cwd: ROOT,
    useEslintrc: false,
    baseConfig: {
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      rules: { [SYNTAX_RULE]: apiSyntax },
    },
  });
  for (const fixture of apiFixtures) {
    const [result] = await linter.lintText(fixture.code, { filePath: join(ROOT, 'fixture.ts') });
    const fatal = result.messages.find((m) => m.fatal);
    if (fatal) {
      fail(`API error guard, ${fixture.name}: could not parse (${fatal.message})`);
      continue;
    }
    const fired = result.messages.some((m) => m.ruleId === SYNTAX_RULE && m.message.includes('describeApiError'));
    if (fired !== fixture.fires) {
      fail(`API error guard, ${fixture.name}: expected it to ${fixture.fires ? 'fire' : 'stay quiet'}, it did not`);
    }
  }
}

if (failures.length > 0) {
  console.error('✗ check-i18n-lint-rule:\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('\n  Fix: keep the override in .eslintrc.js pointing at real folders and make sure no later override disables the rule.');
  process.exit(1);
}
console.log(
  `✓ check-i18n-lint-rule: ${globs(override.files).length} files glob(s) match, the rule is on for ${realFile} and off for tests and copy, ${fixtures.length} fixtures behave; the API error guard is active and ${apiFixtures.length} of its fixtures behave.`,
);
