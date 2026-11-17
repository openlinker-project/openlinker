#!/usr/bin/env node
/**
 * check-release-center-catalog.mjs
 *
 * Lint-time invariant for the release center step catalog and highlights
 * (#4145, ADR-085). Without it the catalog and the changelog drift silently.
 *
 * Rules, in the order they are reported:
 *   1. Every catalog entry has a unique `id` matching ^[a-z0-9]+(-[a-z0-9]+)*$.
 *   2. `introducedIn` is valid semver and not greater than package.json's
 *      version (release-please may pick a number other than the hand-written
 *      next minor; this stops the release instead of hiding the step).
 *   3. `routePattern` is a route path declared in apps/web/src/app/routes.
 *   4. `target` appears as a `data-tour` value somewhere in apps/web/src outside
 *      the catalog itself. Conditional and plugin-rendered elements qualify:
 *      the check is "the value is declared in source", not "always on screen".
 *   5. Every minor from HIGHLIGHTS_REQUIRED_FROM up to the package minor, and
 *      every minor that introduces a step, has a highlights list, and every
 *      listed commit hash exists in CHANGELOG.md.
 *   6. CHANGELOG.md has a heading for the package.json version.
 *
 * The catalog and highlights files are parsed TEXTUALLY (no TypeScript import)
 * so this stays a zero-dependency `check:invariants` step.
 *
 * Run with `--self-check` to exercise the pure helpers on synthetic input.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WEB_SRC = join(root, 'apps', 'web', 'src');
const CATALOG_DIR = join(WEB_SRC, 'features', 'release-center', 'catalog');

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(value) {
  const m = SEMVER.exec(value ?? '');
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
}

/** Core comparison only; a prerelease is ordered below its release. */
export function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return Math.sign(a.core[i] - b.core[i]);
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

/** Splits the catalog source into one text block per entry, starting at each `id:`. */
export function parseCatalogEntries(source) {
  const starts = [...source.matchAll(/^\s{4}id: '([^']*)',$/gm)];
  return starts.map((match, i) => {
    const block = source.slice(match.index, starts[i + 1]?.index ?? source.length);
    const pick = (key) => new RegExp(`${key}: '([^']*)'`).exec(block)?.[1] ?? null;
    return {
      id: match[1],
      introducedIn: pick('introducedIn'),
      routePattern: pick('routePattern'),
      target: pick('target'),
    };
  });
}

export function parseHighlights(source) {
  const body = /RELEASE_HIGHLIGHTS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
  const map = {};
  for (const m of body.matchAll(/'(\d+\.\d+)':\s*\[([^\]]*)\]/g)) {
    map[m[1]] = [...m[2].matchAll(/'([0-9a-f]+)'/g)].map((h) => h[1]);
  }
  const from = /HIGHLIGHTS_REQUIRED_FROM = '(\d+\.\d+)'/.exec(source)?.[1] ?? null;
  return { map, from };
}

const minorOf = (version) => {
  const v = parseSemver(version);
  return v ? `${v.core[0]}.${v.core[1]}` : null;
};
const minorCompare = (a, b) => {
  const [am, an] = a.split('.').map(Number);
  const [bm, bn] = b.split('.').map(Number);
  return am !== bm ? Math.sign(am - bm) : Math.sign(an - bn);
};

/** Pure core of the check. Returns a list of error strings. */
export function validate({
  entries,
  highlights,
  packageVersion,
  routes,
  tourTargets,
  changelog,
}) {
  const errors = [];
  const pkg = parseSemver(packageVersion);
  if (!pkg) return [`package.json version "${packageVersion}" is not valid semver`];

  const seen = new Set();
  for (const e of entries) {
    if (!ID_PATTERN.test(e.id)) errors.push(`step id "${e.id}" does not match ${ID_PATTERN}`);
    if (seen.has(e.id)) errors.push(`step id "${e.id}" is declared twice`);
    seen.add(e.id);
    const intro = parseSemver(e.introducedIn);
    if (!intro) {
      errors.push(`step "${e.id}": introducedIn "${e.introducedIn}" is not valid semver`);
    } else if (compareSemver(intro, pkg) > 0) {
      errors.push(
        `step "${e.id}": introducedIn ${e.introducedIn} is greater than package.json ${packageVersion}`
      );
    }
    if (!e.routePattern || !routes.has(e.routePattern)) {
      errors.push(`step "${e.id}": route "${e.routePattern}" is not declared in the router`);
    }
    if (!e.target || !tourTargets.has(e.target)) {
      errors.push(`step "${e.id}": data-tour target "${e.target}" is not declared in apps/web/src`);
    }
  }

  const required = new Set();
  const current = minorOf(packageVersion);
  if (highlights.from) {
    // Walk minors of the current major from the first required one to the package minor.
    const [major, fromMinor] = highlights.from.split('.').map(Number);
    if (major === pkg.core[0]) {
      for (let n = fromMinor; n <= pkg.core[1]; n += 1) required.add(`${major}.${n}`);
    }
  }
  for (const e of entries) {
    const m = minorOf(e.introducedIn);
    if (m && current && minorCompare(m, current) <= 0) required.add(m);
  }
  for (const minor of required) {
    if (!highlights.map[minor]?.length) {
      errors.push(`release ${minor}: no curated highlights in release-highlights.ts`);
    }
  }
  for (const [minor, hashes] of Object.entries(highlights.map)) {
    for (const hash of hashes) {
      if (hash.length < 7 || !changelog.includes(`/commit/${hash}`)) {
        errors.push(`highlights ${minor}: commit "${hash}" is not in CHANGELOG.md`);
      }
    }
  }
  if (!changelog.includes(`## [${packageVersion}]`)) {
    errors.push(`CHANGELOG.md has no heading for package.json version ${packageVersion}`);
  }
  return errors;
}

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(tsx?|jsx?)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) out.push(p);
  }
  return out;
}

async function collect() {
  const catalog = await readFile(join(CATALOG_DIR, 'release-steps.ts'), 'utf8');
  const highlightsSrc = await readFile(join(CATALOG_DIR, 'release-highlights.ts'), 'utf8');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');

  const routes = new Set();
  for (const file of await walk(join(WEB_SRC, 'app', 'routes'))) {
    for (const m of (await readFile(file, 'utf8')).matchAll(/path: '([^']*)'/g)) routes.add(m[1]);
  }

  const tourTargets = new Set();
  for (const file of await walk(WEB_SRC)) {
    if (file.startsWith(CATALOG_DIR)) continue;
    const text = await readFile(file, 'utf8');
    if (!text.includes('data-tour')) continue;
    for (const m of text.matchAll(/data-tour['"]?\s*[=:]\s*\{?\s*['"]([^'"]+)['"]/g)) {
      tourTargets.add(m[1]);
    }
  }

  return {
    entries: parseCatalogEntries(catalog),
    highlights: parseHighlights(highlightsSrc),
    packageVersion: pkg.version,
    routes,
    tourTargets,
    changelog,
  };
}

function selfCheck() {
  const base = {
    entries: [
      { id: 'a-step', introducedIn: '0.20.0', routePattern: 'x/:id', target: 't1' },
    ],
    highlights: { map: { '0.20': ['abcdef1'] }, from: '0.20' },
    packageVersion: '0.20.0',
    routes: new Set(['x/:id']),
    tourTargets: new Set(['t1']),
    changelog: '## [0.20.0](u)\n(https://x/commit/abcdef1234)',
  };
  const cases = [
    [base, 0],
    [{ ...base, entries: [{ ...base.entries[0], id: 'Bad_Id' }] }, 1],
    [{ ...base, entries: [base.entries[0], base.entries[0]] }, 1],
    [{ ...base, entries: [{ ...base.entries[0], introducedIn: '0.21.0' }] }, 1],
    [{ ...base, routes: new Set() }, 1],
    [{ ...base, tourTargets: new Set() }, 1],
    [{ ...base, highlights: { map: {}, from: '0.20' } }, 1],
    [{ ...base, highlights: { map: { '0.20': ['deadbee'] }, from: '0.20' } }, 1],
    [{ ...base, changelog: '' }, 2],
  ];
  const parsed = parseCatalogEntries("    id: 'one',\n    introducedIn: '0.1.0',\n    target: 'x',\n");
  if (parsed.length !== 1 || parsed[0].target !== 'x') {
    console.error('check-release-center-catalog --self-check FAILED: parseCatalogEntries');
    process.exit(1);
  }
  cases.forEach(([input, expected], i) => {
    const actual = validate(input).length;
    if (actual < expected || (expected === 0 && actual !== 0)) {
      console.error(
        `check-release-center-catalog --self-check FAILED at case ${i}: got ${actual} errors, want ${expected}`
      );
      process.exit(1);
    }
  });
  console.log('check-release-center-catalog --self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck();
  const errors = validate(await collect());
  if (errors.length > 0) {
    console.error('check-release-center-catalog failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('check-release-center-catalog passed');
}

main();
