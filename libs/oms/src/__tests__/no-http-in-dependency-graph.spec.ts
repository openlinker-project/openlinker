/**
 * The OL-OMS has no HTTP client in its dependency graph (#2409 AC-3, ADR-055, DESIGN §9).
 *
 * DESIGN §9's claim is that the only asymmetry between the OL-OMS and a vendor OMS sits BELOW the
 * port line: this holder answers from OpenLinker's own tables, so there is no wire to adapt across.
 * "No wire" is the load-bearing half — an HTTP hop introduced here would land on the ATP publish hot
 * path, and would do so silently, because nothing about the port's shape would change.
 *
 * ## Why this is not already covered
 *
 * `libs/oms` is in `scripts/check-outbound-http.mjs`'s `SCAN_ROOTS` and in the bare-`fetch` ESLint
 * ban, and #2405's docblocks cite both as the mechanisation of this property. **Neither actually
 * asserts it.** Both catch a bare `fetch(` in SOURCE TEXT: the script greps for the call, and the
 * ESLint rule is `no-restricted-globals`, which by definition only sees the global. An `axios`,
 * `got`, `ky` or `undici` dependency added to `package.json` and reached by an ordinary `import`
 * is invisible to both — it is neither a bare `fetch(` token nor a restricted global.
 *
 * So the acceptance criterion asks for a DEPENDENCY-GRAPH assertion and the tree had a
 * SOURCE-TEXT one. This file is the missing half; the two are complementary, not redundant.
 *
 * ## Scope, stated rather than implied
 *
 * The walk is the transitive **workspace** closure reachable from `@openlinker/oms` — today
 * `@openlinker/core`, `@openlinker/plugin-sdk`, `@openlinker/shared` — because a client pulled in
 * one hop down is just as much a wire as one declared here. For the root package every bucket is
 * checked including `devDependencies` (a test-only HTTP client would still be evidence that
 * somebody is building the boundary this package is defined by NOT having); for a transitive
 * package only `dependencies` and `peerDependencies` are, since a dependency's dev tooling does
 * not enter the runtime graph.
 *
 * Third-party transitive deps are deliberately NOT walked. `redis`, `typeorm` and `sanitize-html`
 * each pull their own trees, none of which the OMS chooses or can act on, and an assertion over
 * them would fail for reasons unrelated to this package's design. The property being defended is
 * "the OL-OMS does not reach for a wire", which is a statement about what OpenLinker declares.
 *
 * @module libs/oms/src/__tests__
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Package names that ARE an HTTP client, or exist to make one.
 *
 * A deny-list rather than an allow-list, because an allow-list of every legitimate dependency would
 * fail on ordinary unrelated additions and would be deleted the first time it did.
 */
const HTTP_CLIENT_PACKAGES = [
  '@nestjs/axios',
  'axios',
  'bent',
  'cross-fetch',
  'got',
  'isomorphic-fetch',
  'ky',
  'needle',
  'node-fetch',
  'phin',
  'request',
  'superagent',
  'undici',
];

const ROOT_PACKAGE = '@openlinker/oms';

const LIBS_DIR = join(__dirname, '..', '..', '..');

/**
 * `@openlinker/<name>` -> `libs/<name>/package.json`.
 *
 * That is the layout of every package currently in this graph, but NOT of the repo as a whole:
 * an integration package is `@openlinker/integrations-<x>` at `libs/integrations/<x>`. Rather than
 * teach this walker a second layout it has no reason to need, an unresolvable name is reported as
 * its own failure — because the OMS acquiring a dependency outside `libs/<name>` is itself the
 * thing worth knowing, and an `ENOENT` from `readFileSync` would read as a broken test instead.
 */
const manifestPathFor = (packageName: string): string =>
  join(LIBS_DIR, packageName.replace('@openlinker/', ''), 'package.json');

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const readManifest = (packageName: string): Manifest => {
  const path = manifestPathFor(packageName);
  if (!existsSync(path)) {
    throw new Error(
      `@openlinker/oms's dependency graph reached ${packageName}, whose manifest is not at ${path}. ` +
        `Either the OMS gained a workspace dependency outside libs/<name> (check whether it should ` +
        `have — this package is defined by depending on almost nothing), or the repo layout moved ` +
        `and this walker needs updating.`
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
};

/**
 * Every declared dependency name reachable from the root package, paired with the manifest that
 * declared it — so a failure names WHERE the client entered, not merely that one did.
 */
const collectDeclaredDependencies = (): ReadonlyArray<{ pkg: string; dep: string }> => {
  const collected: { pkg: string; dep: string }[] = [];
  const seen = new Set<string>();
  const queue = [ROOT_PACKAGE];

  for (let pkg = queue.pop(); pkg !== undefined; pkg = queue.pop()) {
    if (seen.has(pkg)) continue;
    seen.add(pkg);

    const manifest = readManifest(pkg);
    const buckets =
      pkg === ROOT_PACKAGE
        ? [manifest.dependencies, manifest.peerDependencies, manifest.devDependencies]
        : [manifest.dependencies, manifest.peerDependencies];

    for (const bucket of buckets) {
      for (const dep of Object.keys(bucket ?? {})) {
        collected.push({ pkg, dep });
        if (dep.startsWith('@openlinker/')) queue.push(dep);
      }
    }
  }

  return collected;
};

describe('@openlinker/oms dependency graph', () => {
  it('should reach every workspace package it depends on, so the walk is not vacuously empty', () => {
    // Without this, a manifest-path typo or a future layout change would make the walk return a
    // short list and the real assertion below would pass by finding nothing to check.
    const walked = new Set(
      collectDeclaredDependencies()
        .map(({ dep }) => dep)
        .filter((dep) => dep.startsWith('@openlinker/'))
    );

    expect(walked).toContain('@openlinker/core');
    expect(walked).toContain('@openlinker/plugin-sdk');
    expect(walked).toContain('@openlinker/shared');
  });

  it('should declare no HTTP client anywhere in its transitive workspace closure', () => {
    const offenders = collectDeclaredDependencies()
      .filter(({ dep }) => HTTP_CLIENT_PACKAGES.includes(dep))
      .map(({ pkg, dep }) => `${pkg} -> ${dep}`);

    // Listed rather than counted: the failure message has to say which package pulled the client
    // in, or the next reader has to re-derive the walk by hand to act on it.
    expect(offenders).toEqual([]);
  });
});
