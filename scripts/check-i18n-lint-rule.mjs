#!/usr/bin/env node
/**
 * check-i18n-lint-rule
 *
 * Proves the no-hardcoded-text rules (ADR-079, #3859) are in force where they
 * are meant to be, not just that their options are well formed. Three things
 * can switch the rule off while `pnpm lint` stays green, and each is checked:
 *
 *   1. A typo or an empty glob in the override's `files` (the docs tell
 *      authors to add a folder there in the same PR). Every glob must match at
 *      least one real file, and the rule must be on for a real
 *      `apps/web/src/shared/ui/*.tsx` file, resolved through the real config.
 *   2. A later override turning the rule off. The rules are taken from
 *      `calculateConfigForFile` for that real path, so the FINAL resolved
 *      config is what gets exercised.
 *   3. An over-broad `words.exclude` entry that matches the empty string.
 *      Fixtures lint with the resolved options: a sentence, a string in a
 *      `{...}` child, a ternary label and a template in a child must be
 *      reported, and copy read from a copy file or a bare glyph must not.
 *
 * It also asserts the rule is OFF for a test file and a `*.copy.ts` file, the
 * two places the override excludes.
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

const override = config.overrides.find((o) => (o.plugins ?? []).includes('i18next'));
if (!override) {
  console.error('✗ check-i18n-lint-rule: no override in .eslintrc.js enables the i18next plugin.');
  process.exit(1);
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
const globs = (value) => (Array.isArray(value) ? value : value ? [value] : []);
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

if (failures.length > 0) {
  console.error('✗ check-i18n-lint-rule:\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('\n  Fix: keep the override in .eslintrc.js pointing at real folders and make sure no later override disables the rule.');
  process.exit(1);
}
console.log(
  `✓ check-i18n-lint-rule: ${globs(override.files).length} files glob(s) match, the rule is on for ${realFile} and off for tests and copy, ${fixtures.length} fixtures behave.`,
);
