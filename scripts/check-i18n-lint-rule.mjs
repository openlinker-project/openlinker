#!/usr/bin/env node
/**
 * check-i18n-lint-rule
 *
 * Proves the no-hardcoded-text ESLint rule (ADR-079, #3859) still fires. The
 * rule is configured with a `words.exclude` list, and one over-broad pattern
 * there (an expression that matches the empty string) silences it completely
 * while `pnpm lint` stays green. This lints two small fixtures with the exact
 * rule options from `.eslintrc.js`: a hard-coded sentence must be reported,
 * and copy read from a copy file or a bare glyph must not.
 *
 * Usage: node scripts/check-i18n-lint-rule.mjs
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { ESLint } = require('eslint');
const config = require(join(ROOT, '.eslintrc.js'));

const override = config.overrides.find((o) => (o.plugins ?? []).includes('i18next'));
if (!override) {
  console.error('✗ check-i18n-lint-rule: no override in .eslintrc.js enables the i18next plugin.');
  process.exit(1);
}

const eslint = new ESLint({
  cwd: ROOT,
  useEslintrc: false,
  baseConfig: {
    parser: '@typescript-eslint/parser',
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    plugins: override.plugins,
    rules: override.rules,
  },
});

const RULE = 'i18next/no-literal-string';
const fixtures = [
  // Component names are PascalCase: the plugin skips a value bound to an
  // ALL-CAPS name, which a one-letter name like `A` would be.
  {
    name: 'a hard-coded sentence',
    code: 'export function SaveBar(): JSX.Element {\n  return <p>Save changes</p>;\n}',
    fires: true,
  },
  {
    name: 'a hard-coded sentence in an arrow component',
    code: 'export const SaveHint = (): JSX.Element => <p>Save changes</p>;',
    fires: true,
  },
  { name: 'copy from a copy file', code: 'export const SaveLabel = (): JSX.Element => <p>{copy.save}</p>;', fires: false },
  { name: 'a bare glyph', code: 'export const Ellipsis = (): JSX.Element => <span>…</span>;', fires: false },
];

const failures = [];
for (const fixture of fixtures) {
  const [result] = await eslint.lintText(fixture.code, { filePath: join(ROOT, 'fixture.tsx') });
  const fired = result.messages.some((m) => m.ruleId === RULE);
  const fatal = result.messages.find((m) => m.fatal);
  if (fatal) failures.push(`${fixture.name}: could not parse (${fatal.message})`);
  else if (fired !== fixture.fires) {
    failures.push(`${fixture.name}: expected the rule to ${fixture.fires ? 'fire' : 'stay quiet'}, it did not`);
  }
}

if (failures.length > 0) {
  console.error('✗ check-i18n-lint-rule:\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`✓ check-i18n-lint-rule: ${fixtures.length} fixtures behave.`);
