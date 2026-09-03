/**
 * `ReturnsAuthority` Dispatch Guard (#2351)
 *
 * `ReturnsAuthority` enters `CoreCapabilityValues` in Wave 2 because an operator
 * WRITES it into `enabledCapabilities` (both connection DTOs `@IsIn`-validate
 * against that array, so a name kept out is a name that cannot be written).
 * Wave 2 only ever READS that declaration — `resolveAuthorities` narrows from
 * the declaration lists, never from a constructed adapter.
 *
 * There is no `ReturnsAuthorityPort` yet, so resolving one by connection id
 * would pass the manifest gate and then fail inside `dispatchCapability` with a
 * generic `Error` — and in `listCapabilityAdapters` that aborts the whole
 * listing rather than skipping the connection (see the architecture overview's
 * "advertised-without-dispatch" note).
 *
 * This is the `resolve_category` precedent: a spec that BREAKS when a later wave
 * (`W3a-14`) wires dispatch, rather than a comment that rots.
 *
 * @module libs/core/src/integrations/domain/types/__tests__
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../../../..');

const SCAN_ROOTS = [
  join('libs', 'core', 'src'),
  join('libs', 'integrations'),
  join('apps', 'api', 'src'),
  join('apps', 'worker', 'src'),
];

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo']);

/** A dispatch call and a `ReturnsAuthority` literal in the same expression. */
const DISPATCH_RE =
  /(getCapabilityAdapter|listCapabilityAdapters)[\s\S]{0,300}?['"]ReturnsAuthority['"]/;

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (full.endsWith('.ts') && !full.endsWith('.d.ts') && !full.endsWith(__filename)) {
      out.push(full);
    }
  }
}

describe('ReturnsAuthority', () => {
  it('should have a detector that actually detects (positive control)', () => {
    // Without this, a regex broken by a later edit would make the scan below
    // pass vacuously — the failure mode a "nothing found" assertion cannot see.
    expect(
      DISPATCH_RE.test(
        "await this.integrations.getCapabilityAdapter<ReturnsAuthorityPort>(id, 'ReturnsAuthority');"
      )
    ).toBe(true);
    expect(
      DISPATCH_RE.test(
        "await this.integrations.listCapabilityAdapters({\n  capability: 'ReturnsAuthority',\n});"
      )
    ).toBe(true);
    expect(DISPATCH_RE.test("enabledCapabilities.includes('ReturnsAuthority')")).toBe(false);
  });

  it('should never be resolved by connection id in Wave 2', () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      walk(join(REPO_ROOT, root), files);
    }
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter(
      (file) => file !== __filename && DISPATCH_RE.test(readFileSync(file, 'utf8'))
    );

    expect(offenders.map((file) => file.slice(REPO_ROOT.length + 1))).toEqual([]);
  });
});
