/**
 * Cross-context Barrel Purity — smoke check
 *
 * Asserts every bounded context's main barrel evaluates without a thrown
 * error and exports at least one named symbol.
 *
 * Scope is deliberately thin. CJS circular requires generally do NOT throw —
 * they return a partial module silently, and the typical #337 symptom
 * (`Symbol(?)` DI failure) only surfaces later when Nest tries to resolve
 * providers at boot. This spec won't catch that class of cycle on its own.
 * What it does catch: gross barrel misconfiguration (typo'd re-export path,
 * top-level side-effect that throws, an empty barrel) that would otherwise
 * surface as a confusing error deep in some downstream test.
 *
 * The listings-specific deny-list at
 * `libs/core/src/listings/__tests__/barrel-purity.spec.ts` is the stronger
 * test — it pins the specific exports the #337 fix removed. Equivalent
 * per-context deny-lists for the other 13 contexts are deferred until each
 * has a concrete cycle bug to forbid the reintroduction of.
 *
 * When this spec fails: a recent edit either (a) added a new context
 * without listing it in CONTEXT_BARRELS, or (b) introduced a top-level
 * throw / completely-empty re-export pattern in an existing barrel.
 *
 * @module libs/core/src/__tests__
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CONTEXT_BARRELS = [
  'ai',
  'catalog-trust',
  'content',
  'customers',
  'events',
  'identifier-mapping',
  'integrations',
  'inventory',
  'listings',
  'mappings',
  'orders',
  'products',
  'sales-documents',
  'sync',
  'users',
  'webhooks',
] as const;

describe('@openlinker/core/<context> barrel purity (#598)', () => {
  it.each(CONTEXT_BARRELS)('imports @openlinker/core/%s without throwing', (context) => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- dynamic require() needed: path computed at runtime
      const mod = require(`../${context}`) as Record<string, unknown>;
      expect(mod).toBeTruthy();
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  /**
   * `sales-documents` (#2100) is the one context whose value is that it depends on
   * NOTHING: `invoicing` and `orders` both value-import it, and `invoicing` would
   * close a CJS module-load cycle the moment this leaf grew an edge back into
   * either. Three docblocks call that load-bearing; before this assertion nothing
   * enforced it, so a future `import` here would have been caught only by a Nest
   * boot failure in some unrelated suite.
   *
   * Textual, deliberately: a `require()` cannot see whether the module pulled a
   * dependency in, and the whole point is to forbid the import statement itself.
   */
  it('sales-documents stays a dependency-free leaf (no import statements at all)', () => {
    const root = join(__dirname, '..', 'sales-documents');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(full);
      }
    };
    walk(root);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Scanned over the WHOLE file, not line by line: a multi-line
      // `import type {\n  X,\n} from '…'` — the prevailing style in this repo, and
      // exactly what an edit here would produce — puts `import` and `from` on
      // different lines, so a per-line matcher would let it through.
      const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      // The barrel's own `export * from './domain/...'` is the one allowed edge:
      // internal to the concern, so it cannot reach another context.
      expect(specifiers.filter((s) => !s.startsWith('./'))).toEqual([]);
    }
  });
});
