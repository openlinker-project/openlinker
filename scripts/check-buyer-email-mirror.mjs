#!/usr/bin/env node
/**
 * check-buyer-email-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the buyer-email
 * rules (#3554 / #3555).
 *
 * The authoritative declarations live in
 *   libs/core/src/identifier-mapping/domain/types/buyer-emails-config.types.ts
 * and the browser restates them because it does not depend on `@openlinker/core`
 * (#591):
 *   apps/web/src/features/buyer-emails/api/buyer-emails.types.ts   (template lists)
 *   apps/web/src/features/buyer-emails/lib/buyer-emails-config.ts  (channel rule, address check)
 *
 * A drift is silent: a template added in core is never offered, a changed
 * channel rule makes the settings page offer a template the server gate then
 * suppresses, and a different address check lets the form accept a sender the
 * server drops. Four rules, all parsed TEXTUALLY (no TypeScript import) so this
 * stays a zero-dependency `check:invariants` step:
 *   1. the template list - value + order equality;
 *   2. the marketplace template list - value + order equality;
 *   3. the channel rule - the same capability tests, negations and branch order;
 *   4. the single-address regex - literal equality.
 *
 * Run with `--self-check` to exercise the parsers + differ on synthetic inputs,
 * including deliberately drifted fixtures.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORE_FILE = join(
  'libs', 'core', 'src', 'identifier-mapping', 'domain', 'types', 'buyer-emails-config.types.ts',
);
const FE_TYPES_FILE = join('apps', 'web', 'src', 'features', 'buyer-emails', 'api', 'buyer-emails.types.ts');
const FE_CONFIG_FILE = join('apps', 'web', 'src', 'features', 'buyer-emails', 'lib', 'buyer-emails-config.ts');

const PAIRS = [
  { core: 'BuyerEmailTemplateValues', frontend: 'BUYER_EMAIL_TEMPLATE_VALUES' },
  { core: 'MarketplaceBuyerEmailTemplateValues', frontend: 'MARKETPLACE_BUYER_EMAIL_TEMPLATES' },
];
const CHANNEL_FUNCTIONS = { core: 'buyerEmailChannelKindOf', frontend: 'channelKindOf' };
const ADDRESS_FUNCTION = 'isSingleEmailAddress';

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** Values of `export const <name> = [...]` (with or without `as const`), in order, or null. */
export function parseValues(source, name) {
  const match = new RegExp(`export const ${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\]`).exec(
    stripComments(source),
  );
  if (match === null) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The body of `export function <name>(...) { ... }`, up to the first closing brace at column 0. */
function functionBody(source, name) {
  const match = new RegExp(`export function ${name}\\s*\\([\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`).exec(
    stripComments(source),
  );
  return match === null ? null : match[1];
}

/**
 * The channel rule as a comparable signature: every `.includes('X')` test in
 * order (with `!` kept), then the ternary's two branch values in order.
 */
export function parseChannelRule(source, name) {
  const body = functionBody(source, name);
  if (body === null) return null;
  const tests = [...body.matchAll(/(!?)\s*\w+\.includes\('([^']+)'\)/g)].map((m) => `${m[1]}${m[2]}`);
  const branches = /\?\s*'([^']+)'\s*:\s*'([^']+)'/.exec(body);
  if (tests.length === 0 || branches === null) return null;
  return `${tests.join(' && ')} ? ${branches[1]} : ${branches[2]}`;
}

/** The regex literal tested inside `isSingleEmailAddress`, or null. */
export function parseAddressRegex(source) {
  const body = functionBody(source, ADDRESS_FUNCTION);
  if (body === null) return null;
  const match = /(\/\^[^\n]*?\$\/)\.test\(/.exec(body);
  return match === null ? null : match[1];
}

export function diffValues(label, core, frontend) {
  if (core === null) return [`core declares no ${label}`];
  if (frontend === null) return [`frontend declares no mirror of ${label}`];
  if (core.length === frontend.length && core.every((v, i) => v === frontend[i])) return [];
  return [`${label} drifted: core [${core.join(', ')}] vs frontend [${frontend.join(', ')}]`];
}

export function diffScalar(label, core, frontend) {
  if (core === null) return [`could not read ${label} in core`];
  if (frontend === null) return [`could not read ${label} in the frontend`];
  return core === frontend ? [] : [`${label} drifted: core \`${core}\` vs frontend \`${frontend}\``];
}

export function check({ core, feTypes, feConfig }) {
  return [
    ...PAIRS.flatMap((pair) =>
      diffValues(pair.core, parseValues(core, pair.core), parseValues(feTypes, pair.frontend)),
    ),
    ...diffScalar(
      'the channel rule',
      parseChannelRule(core, CHANNEL_FUNCTIONS.core),
      parseChannelRule(feConfig, CHANNEL_FUNCTIONS.frontend),
    ),
    ...diffScalar('the single-address check', parseAddressRegex(core), parseAddressRegex(feConfig)),
  ];
}

function selfCheck() {
  const list = (name, vals, asConst = true) =>
    `export const ${name} = [${vals.map((v) => `'${v}'`).join(', ')}]${asConst ? ' as const' : ''};\n`;
  const rule = (name, a, b, first = 'marketplace', second = 'shop') =>
    `export function ${name}(c: readonly string[]): K {\n  return c.includes('${a}') && !c.includes('${b}')\n    ? '${first}'\n    : '${second}';\n}\n`;
  const address = (re) =>
    `export function ${ADDRESS_FUNCTION}(value: string): boolean {\n  return ${re}.test(value);\n}\n`;
  const RE = '/^[^\\s@]+@[^\\s@]+$/';

  const core = (opts = {}) =>
    list('BuyerEmailTemplateValues', opts.templates ?? ['a', 'b']) +
    list('MarketplaceBuyerEmailTemplateValues', opts.marketplace ?? ['b']) +
    rule('buyerEmailChannelKindOf', 'OfferManager', 'ProductMaster') +
    address(RE);
  const feTypes = (opts = {}) =>
    list('BUYER_EMAIL_TEMPLATE_VALUES', opts.templates ?? ['a', 'b']) +
    list('MARKETPLACE_BUYER_EMAIL_TEMPLATES', opts.marketplace ?? ['b'], false);
  const feConfig = (opts = {}) =>
    rule('channelKindOf', opts.a ?? 'OfferManager', 'ProductMaster', opts.first, opts.second) +
    address(opts.re ?? RE);

  const cases = [
    ['identical', core(), feTypes(), feConfig(), 0],
    ['template added in core only', core({ templates: ['a', 'b', 'c'] }), feTypes(), feConfig(), 1],
    ['marketplace list reordered', core({ marketplace: ['a', 'b'] }), feTypes({ marketplace: ['b', 'a'] }), feConfig(), 1],
    ['channel rule tests another capability', core(), feTypes(), feConfig({ a: 'OrderSource' }), 1],
    ['channel rule branches swapped', core(), feTypes(), feConfig({ first: 'shop', second: 'marketplace' }), 1],
    ['address regex loosened', core(), feTypes(), feConfig({ re: '/^.+@.+$/' }), 1],
    ['frontend list missing', core(), list('BUYER_EMAIL_TEMPLATE_VALUES', ['a', 'b']), feConfig(), 1],
  ];
  let failed = 0;
  for (const [label, c, t, f, expected] of cases) {
    const got = check({ core: c, feTypes: t, feConfig: f }).length;
    if (got !== expected) {
      console.error(`self-check FAILED: ${label} (expected ${expected} violation(s), got ${got})`);
      failed++;
    }
  }
  if (failed > 0) process.exit(1);
  console.log('check-buyer-email-mirror self-check: ok');
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck();
  const [core, feTypes, feConfig] = await Promise.all(
    [CORE_FILE, FE_TYPES_FILE, FE_CONFIG_FILE].map((f) => readFile(join(repoRoot, f), 'utf8')),
  );
  const violations = check({ core, feTypes, feConfig });
  if (violations.length > 0) {
    for (const v of violations) console.error(`check-buyer-email-mirror: ${v}`);
    console.error(`Fix: make ${FE_TYPES_FILE} and ${FE_CONFIG_FILE} match ${CORE_FILE}.`);
    process.exit(1);
  }
  console.log('check-buyer-email-mirror: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
