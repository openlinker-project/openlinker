#!/usr/bin/env node
/**
 * check-buyer-data-retention-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the buyer data
 * retention rules (#4289).
 *
 * The authoritative declarations live in
 *   libs/core/src/operational-settings/domain/types/operational-settings.types.ts
 * (the erase-mode values, the period bounds and the built-in defaults; the
 * per-connection validator, the settings service, the preview endpoint and the
 * DTOs all read them from there) and the browser restates them because it does
 * not depend on `@openlinker/core` (#591):
 *   apps/web/src/features/buyer-data/api/buyer-data.types.ts   (erase modes)
 *   apps/web/src/features/buyer-data/lib/buyer-data-config.ts  (period bounds, defaults)
 *
 * A drift is silent and fails in the worst place: a server bound that moves
 * leaves the period input and the trial-run gate accepting a number the API
 * answers 400 to, and an erase mode added in core is never offered. Four rules,
 * parsed TEXTUALLY so this stays a zero-dependency `check:invariants` step:
 *   1. the erase-mode values - value + order equality;
 *   2. the minimum period in days - literal equality;
 *   3. the maximum period in days - literal equality;
 *   4. the built-in defaults (enabled, hide, erase, mode) - literal equality.
 *
 * Run with `--self-check` to exercise the parsers + differ on synthetic inputs,
 * including deliberately drifted fixtures.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORE_FILE = join(
  'libs', 'core', 'src', 'operational-settings', 'domain', 'types', 'operational-settings.types.ts',
);
const FE_TYPES_FILE = join('apps', 'web', 'src', 'features', 'buyer-data', 'api', 'buyer-data.types.ts');
const FE_CONFIG_FILE = join('apps', 'web', 'src', 'features', 'buyer-data', 'lib', 'buyer-data-config.ts');

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** Values of `export const <name> = [...]`, in order, or null. */
export function parseValues(source, name) {
  const match = new RegExp(`export const ${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\]`).exec(
    stripComments(source),
  );
  if (match === null) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The integer of `export const <name> = 123`, or null. */
export function parseNumber(source, name) {
  const match = new RegExp(`export const ${name}\\b[^=]*=\\s*(\\d+)\\s*;`).exec(stripComments(source));
  return match === null ? null : Number(match[1]);
}

/**
 * The defaults object as a comparable signature `enabled=false;hide=0;erase=0;mode=personal-data`.
 * Core spells the keys `hideAfterDays` / `eraseAfterDays` inside
 * BUYER_DATA_RETENTION_DEFAULTS, the frontend inside BUYER_DATA_DEFAULT_RULES.
 */
export function parseDefaults(source, name) {
  const match = new RegExp(`export const ${name}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\}`).exec(
    stripComments(source),
  );
  if (match === null) return null;
  const read = (key) => new RegExp(`${key}:\\s*([^,\\n}]+)`).exec(match[1])?.[1].trim().replace(/['"]/g, '');
  const parts = ['enabled', 'hideAfterDays', 'eraseAfterDays', 'mode'].map((key) => [key, read(key)]);
  if (parts.some(([, value]) => value === undefined)) return null;
  return parts.map(([key, value]) => `${key}=${value}`).join(';');
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
    ...diffValues(
      'the erase modes',
      parseValues(core, 'BUYER_DATA_ERASE_MODES'),
      parseValues(feTypes, 'BUYER_DATA_ERASE_MODES'),
    ),
    ...diffScalar(
      'the minimum period (days)',
      parseNumber(core, 'BUYER_DATA_PERIOD_MIN_DAYS'),
      parseNumber(feConfig, 'BUYER_DATA_MIN_DAYS'),
    ),
    ...diffScalar(
      'the maximum period (days)',
      parseNumber(core, 'BUYER_DATA_PERIOD_MAX_DAYS'),
      parseNumber(feConfig, 'BUYER_DATA_MAX_DAYS'),
    ),
    ...diffScalar(
      'the built-in defaults',
      parseDefaults(core, 'BUYER_DATA_RETENTION_DEFAULTS'),
      parseDefaults(feConfig, 'BUYER_DATA_DEFAULT_RULES'),
    ),
  ];
}

function selfCheck() {
  const list = (vals) =>
    `export const BUYER_DATA_ERASE_MODES = [${vals.map((v) => `'${v}'`).join(', ')}] as const;\n`;
  const num = (name, n) => `export const ${name} = ${n};\n`;
  const defaults = (name, o = {}) =>
    `export const ${name}: X = {\n  enabled: ${o.enabled ?? false},\n  hideAfterDays: ${o.hide ?? 0},\n  eraseAfterDays: ${o.erase ?? 0},\n  mode: '${o.mode ?? 'personal-data'}',\n};\n`;

  const core = (o = {}) =>
    list(o.modes ?? ['personal-data', 'whole-order']) +
    num('BUYER_DATA_PERIOD_MIN_DAYS', o.min ?? 30) +
    num('BUYER_DATA_PERIOD_MAX_DAYS', o.max ?? 3650) +
    defaults('BUYER_DATA_RETENTION_DEFAULTS');
  const feTypes = (o = {}) => list(o.modes ?? ['personal-data', 'whole-order']);
  const feConfig = (o = {}) =>
    num('BUYER_DATA_MIN_DAYS', o.min ?? 30) +
    num('BUYER_DATA_MAX_DAYS', o.max ?? 3650) +
    defaults('BUYER_DATA_DEFAULT_RULES', o.defaults);

  const cases = [
    ['identical', core(), feTypes(), feConfig(), 0],
    ['maximum raised in core only', core({ max: 7300 }), feTypes(), feConfig(), 1],
    ['minimum lowered in the frontend only', core(), feTypes(), feConfig({ min: 7 }), 1],
    ['erase mode added in core only', core({ modes: ['personal-data', 'whole-order', 'x'] }), feTypes(), feConfig(), 1],
    ['erase modes reordered', core(), feTypes({ modes: ['whole-order', 'personal-data'] }), feConfig(), 1],
    ['default mode changed in the frontend', core(), feTypes(), feConfig({ defaults: { mode: 'whole-order' } }), 1],
    ['default enabled flipped in the frontend', core(), feTypes(), feConfig({ defaults: { enabled: true } }), 1],
    ['frontend modes missing', core(), '', feConfig(), 1],
    ['frontend bounds missing', core(), feTypes(), defaults('BUYER_DATA_DEFAULT_RULES'), 2],
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
  console.log('check-buyer-data-retention-mirror self-check: ok');
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck();
  const [core, feTypes, feConfig] = await Promise.all(
    [CORE_FILE, FE_TYPES_FILE, FE_CONFIG_FILE].map((f) => readFile(join(repoRoot, f), 'utf8')),
  );
  const violations = check({ core, feTypes, feConfig });
  if (violations.length > 0) {
    for (const v of violations) console.error(`check-buyer-data-retention-mirror: ${v}`);
    console.error(`Fix: make ${FE_TYPES_FILE} and ${FE_CONFIG_FILE} match ${CORE_FILE}.`);
    process.exit(1);
  }
  console.log('check-buyer-data-retention-mirror: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
