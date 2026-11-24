#!/usr/bin/env node
/**
 * check-catalogue-mode-mirror.mjs
 *
 * Lint-time invariant for the hand-copied frontend mirror of the catalogue
 * mode vocabulary (#4281).
 *
 * `CatalogueModeValues` in
 *   libs/core/src/identifier-mapping/domain/types/catalogue-mode.types.ts  (authoritative)
 * and
 *   apps/web/src/features/connections/lib/catalogue-mode.ts                (mirror)
 * must list the same members in the same order, and the mirror's default read
 * must be the core default. The browser cannot import `@openlinker/core` (#591),
 * so a value added backend-side would otherwise silently read as `linked` here.
 *
 * Scope: the value list and the default (`DEFAULT_CATALOGUE_MODE` in core, the
 * fallback arm of `readCatalogueMode` in the mirror). Textual parse, no deps.
 *
 * Run with `--self-check` to exercise the extractors on synthetic inputs.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BACKEND = join('libs', 'core', 'src', 'identifier-mapping', 'domain', 'types', 'catalogue-mode.types.ts');
const FRONTEND = join('apps', 'web', 'src', 'features', 'connections', 'lib', 'catalogue-mode.ts');

export function extractValues(source) {
  const m = source.match(/export const CatalogueModeValues\s*=\s*\[([^\]]*)\]\s*as const/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

export function extractDefault(source) {
  const core = source.match(/DEFAULT_CATALOGUE_MODE\s*:\s*CatalogueMode\s*=\s*'([^']+)'/);
  if (core) return core[1];
  const fe = source.match(/:\s*'([^']+)'\s*;?\s*\n?\s*}\s*$/m);
  return fe ? fe[1] : null;
}

function selfCheck() {
  const ok = "export const CatalogueModeValues = ['linked', 'none'] as const;";
  if (JSON.stringify(extractValues(ok)) !== '["linked","none"]') throw new Error('values');
  if (extractValues('nothing') !== null) throw new Error('absent');
  if (extractDefault("export const DEFAULT_CATALOGUE_MODE: CatalogueMode = 'linked';") !== 'linked')
    throw new Error('default');
  console.log('check-catalogue-mode-mirror self-check ok');
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck();
  const [be, fe] = await Promise.all([
    readFile(join(root, BACKEND), 'utf8'),
    readFile(join(root, FRONTEND), 'utf8'),
  ]);
  const errors = [];
  const beValues = extractValues(be);
  const feValues = extractValues(fe);
  if (!beValues) errors.push(`${BACKEND}: CatalogueModeValues not found`);
  if (!feValues) errors.push(`${FRONTEND}: CatalogueModeValues not found`);
  if (beValues && feValues && JSON.stringify(beValues) !== JSON.stringify(feValues)) {
    errors.push(`CatalogueModeValues differ: core ${JSON.stringify(beValues)} vs web ${JSON.stringify(feValues)}`);
  }
  const beDefault = extractDefault(be);
  const feDefault = extractDefault(fe);
  if (beDefault && feDefault && beDefault !== feDefault) {
    errors.push(`default differs: core '${beDefault}' vs web '${feDefault}'`);
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('check-catalogue-mode-mirror ok');
}

main();
