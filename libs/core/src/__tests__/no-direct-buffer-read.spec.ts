/**
 * The stock safety buffer has ONE reader (#2323, ADR-061)
 *
 * `readStockSafetyBuffer` / `isPresentButInvalidStockSafetyBuffer` /
 * `applyStockSafetyBuffer` (#1844) used to be imported by four unrelated
 * publish sites, each of which kept its own private read-warn-apply copy. Four
 * copies is four places for the arithmetic to drift, four places for the
 * "present but invalid" warning to be forgotten, and — the reason this spec is
 * a build gate rather than a review note — four places a future Control
 * (a reservation term, a per-location cap) would have to be added, silently
 * publishing a wrong number wherever it was missed.
 *
 * Since #2323 the buffer is a Control owned by `IAvailabilityService`. Every
 * publish site asks `applyPublishControls`; the one operator-facing surface
 * that needs to DISPLAY the cushion asks `getAppliedReserve` rather than
 * reading the helpers itself.
 *
 * **There are no exemptions, deliberately.** A "display only" carve-out is
 * exactly how the scatter starts again: the next reader copies the exemption
 * rather than the reasoning, and a display read is one edit away from becoming
 * an applied one.
 *
 * ## When this spec fails
 *
 * You imported a buffer helper outside its owner. Call
 * `IAvailabilityService.applyPublishControls` (to compute a quantity) or
 * `getAppliedReserve` (to show the operator the cushion) instead. If you are
 * genuinely adding a new Control, add it to `AvailabilityService.resolveBuffer`
 * — that is the point of there being one.
 *
 * The walk is textual (the barrel-purity pattern): a `require()` cannot see
 * whether a module imported a symbol, and forbidding the import STATEMENT is
 * the whole guarantee.
 *
 * @module libs/core/src/__tests__
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The #1844 helpers. Any import of any of these is what this spec polices. */
const BUFFER_HELPERS = [
  'readStockSafetyBuffer',
  'isPresentButInvalidStockSafetyBuffer',
  'applyStockSafetyBuffer',
] as const;

/**
 * Paths (relative to `libs/core/src`, POSIX separators) allowed to name a
 * helper. Three entries, and each is a role rather than a convenience:
 *   - the identifier-mapping module that DEFINES them;
 *   - `availability.types.ts`, where `computeAtp` applies the buffer as the
 *     last term of the ATP formula;
 *   - `availability.service.ts`, the sole resolver and warner.
 */
const AUTHORIZED_PATHS = [
  'identifier-mapping/',
  'inventory/domain/types/availability.types.ts',
  'inventory/application/services/availability.service.ts',
] as const;

const SRC_ROOT = join(__dirname, '..');

function collectSourceFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      collectSourceFiles(full, acc);
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) acc.push(full);
  }
}

/** Import/export statements only — prose mentioning a helper name is not a read. */
function importedSymbols(source: string): string[] {
  // Comments are stripped first: this repo's docblocks routinely narrate the
  // very rule being checked (this file included), naming the helpers in prose
  // that a naive scan would read as a violation.
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
  const statements = [
    ...withoutComments.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g),
  ];
  return statements.flatMap(([, clause]) =>
    clause
      .split(',')
      .map((part) => part.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
  );
}

describe('stock safety buffer helpers have exactly one reader (#2323)', () => {
  const files: string[] = [];
  collectSourceFiles(SRC_ROOT, files);

  // An empty walk must FAIL rather than vacuously pass — a moved directory
  // would otherwise retire the guarantee in silence.
  it('walks a non-empty set of core sources', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('is imported only by its owner and the availability seam', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const relative = file.slice(SRC_ROOT.length + 1).split(/[\\/]/).join('/');
      if (AUTHORIZED_PATHS.some((allowed) => relative.startsWith(allowed))) continue;

      const symbols = importedSymbols(readFileSync(file, 'utf8'));
      const found = BUFFER_HELPERS.filter((helper) => symbols.includes(helper));
      if (found.length > 0) offenders.push(`${relative} imports ${found.join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the authorized list to the owner plus the seam', () => {
    // Pinned so widening the allow-list is a deliberate edit to a failing
    // assertion, not a quiet append that nobody reviews.
    expect([...AUTHORIZED_PATHS]).toEqual([
      'identifier-mapping/',
      'inventory/domain/types/availability.types.ts',
      'inventory/application/services/availability.service.ts',
    ]);
  });
});
