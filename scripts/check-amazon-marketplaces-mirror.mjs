#!/usr/bin/env node
/**
 * check-amazon-marketplaces-mirror.mjs
 *
 * Lint-time invariant for the browser copy of Amazon's regions and
 * marketplaces (#4186). The browser bundle cannot import
 * `@openlinker/integrations-amazon` (#591), so three facts are written twice:
 *
 *   libs/integrations/amazon/src/amazon.constants.ts        (authority)
 *   apps/web/src/features/amazon/lib/amazon-marketplaces.ts (browser copy)
 *
 *   - `AmazonRegionValues`
 *   - `AMAZON_SINGLE_MARKETPLACE_REGIONS`
 *   - every marketplace's id, country, region and currency
 *     (`AMAZON_KNOWN_MARKETPLACES` / `AMAZON_MARKETPLACES`)
 *
 * Drift is not cosmetic: the form would offer a marketplace the API refuses,
 * hide one it accepts, or let a Far East connection save two marketplaces the
 * API then refuses. Order is ignored; content is compared.
 *
 * Both files are parsed TEXTUALLY so this stays a zero-dependency
 * `check:invariants` step like its siblings. Run with `--self-check` to
 * exercise the parsers and the differ against synthetic input.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const BACKEND = 'libs/integrations/amazon/src/amazon.constants.ts';
const BROWSER = 'apps/web/src/features/amazon/lib/amazon-marketplaces.ts';

/** The string members of `<name> ... = [ 'a', 'b' ]`, or null when absent. */
export function parseStringArray(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`));
  if (!match) {
    return null;
  }
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** The body of the `{ ... }` or `[ ... ]` literal assigned to `<name>`. */
function literalBody(source, name, open, close) {
  const start = source.search(new RegExp(`\\b${name}\\b[^=]*=\\s*\\${open}`));
  if (start < 0) {
    return null;
  }
  const from = source.indexOf(open, source.indexOf('=', start));
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    if (source[i] === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(from + 1, i);
      }
    }
  }
  return null;
}

function field(text, key) {
  const match = text.match(new RegExp(`\\b${key}:\\s*['"]([^'"]+)['"]`));
  return match ? match[1] : null;
}

/** Backend: `ID: { country: 'CA', region: 'na', currency: 'CAD', ... },` */
export function parseBackendMarketplaces(source) {
  const body = literalBody(source, 'AMAZON_KNOWN_MARKETPLACES', '{', '}');
  if (body === null) {
    return null;
  }
  return [...body.matchAll(/([A-Z0-9]{10,14})\s*:\s*\{([^}]*)\}/g)].map((m) => ({
    id: m[1],
    country: field(m[2], 'country'),
    region: field(m[2], 'region'),
    currency: field(m[2], 'currency'),
  }));
}

/** Browser: `{ id: 'ID', country: 'CA', region: 'na', currency: 'CAD' },` */
export function parseBrowserMarketplaces(source) {
  const body = literalBody(source, 'AMAZON_MARKETPLACES', '[', ']');
  if (body === null) {
    return null;
  }
  return [...body.matchAll(/\{([^}]*)\}/g)].map((m) => ({
    id: field(m[1], 'id'),
    country: field(m[1], 'country'),
    region: field(m[1], 'region'),
    currency: field(m[1], 'currency'),
  }));
}

function key(marketplace) {
  return `${marketplace.id} ${marketplace.country} ${marketplace.region} ${marketplace.currency}`;
}

/** Problems as sentences; empty when the two copies agree. */
export function diff(backend, browser) {
  const problems = [];
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
  if (!sameSet(backend.regions, browser.regions)) {
    problems.push(`AmazonRegionValues: backend [${backend.regions}] vs browser [${browser.regions}]`);
  }
  if (!sameSet(backend.singleRegions, browser.singleRegions)) {
    problems.push(
      `AMAZON_SINGLE_MARKETPLACE_REGIONS: backend [${backend.singleRegions}] vs browser [${browser.singleRegions}]`,
    );
  }
  const backendKeys = new Set(backend.marketplaces.map(key));
  const browserKeys = new Set(browser.marketplaces.map(key));
  for (const k of backendKeys) {
    if (!browserKeys.has(k)) problems.push(`missing in the browser copy: ${k}`);
  }
  for (const k of browserKeys) {
    if (!backendKeys.has(k)) problems.push(`not in the backend list: ${k}`);
  }
  return problems;
}

function read(source, parseMarketplaces) {
  return {
    regions: parseStringArray(source, 'AmazonRegionValues'),
    singleRegions: parseStringArray(source, 'AMAZON_SINGLE_MARKETPLACE_REGIONS'),
    marketplaces: parseMarketplaces(source),
  };
}

function selfCheck() {
  const backendSource = `
export const AmazonRegionValues = ['eu', 'na'] as const;
export const AMAZON_SINGLE_MARKETPLACE_REGIONS: readonly AmazonRegion[] = ['fe'];
export const AMAZON_KNOWN_MARKETPLACES: Readonly<Record<string, X>> = {
  A1PA6795UKMFR9: { country: 'DE', region: 'eu', currency: 'EUR', languageTag: 'de_DE' },
};`;
  const browserSource = `
export const AmazonRegionValues = ['na', 'eu'] as const;
export const AMAZON_SINGLE_MARKETPLACE_REGIONS: readonly AmazonRegion[] = ['fe'];
export const AMAZON_MARKETPLACES: readonly AmazonMarketplace[] = [
  { id: 'A1PA6795UKMFR9', country: 'DE', region: 'eu', currency: 'EUR' },
];`;
  const backend = read(backendSource, parseBackendMarketplaces);
  const browser = read(browserSource, parseBrowserMarketplaces);
  if (diff(backend, browser).length !== 0) {
    throw new Error(`self-check: identical copies reported as drifted: ${diff(backend, browser)}`);
  }
  const drifted = read(browserSource.replace("currency: 'EUR'", "currency: 'PLN'"), parseBrowserMarketplaces);
  if (diff(backend, drifted).length !== 2) {
    throw new Error('self-check: a changed currency was not reported on both sides');
  }
  const single = read(browserSource.replace("['fe']", "['fe', 'eu']"), parseBrowserMarketplaces);
  if (diff(backend, single).length !== 1) {
    throw new Error('self-check: a changed single-marketplace region list was not reported');
  }
  process.stdout.write('check-amazon-marketplaces-mirror: self-check passed\n');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }
  const backend = read(await readFile(join(ROOT, BACKEND), 'utf8'), parseBackendMarketplaces);
  const browser = read(await readFile(join(ROOT, BROWSER), 'utf8'), parseBrowserMarketplaces);
  for (const [file, copy] of [[BACKEND, backend], [BROWSER, browser]]) {
    for (const [name, value] of Object.entries(copy)) {
      if (value === null || value.length === 0) {
        process.stderr.write(`${file}: could not read ${name}\n`);
        process.exit(1);
      }
    }
  }
  const problems = diff(backend, browser);
  if (problems.length > 0) {
    process.stderr.write(`Amazon marketplace mirror drifted (${BACKEND} vs ${BROWSER}):\n`);
    for (const problem of problems) {
      process.stderr.write(`  ${problem}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `check-amazon-marketplaces-mirror: ok (${backend.marketplaces.length} marketplaces, ${backend.regions.length} regions in sync)\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
