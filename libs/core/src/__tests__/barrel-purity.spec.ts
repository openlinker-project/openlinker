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

const CONTEXT_BARRELS = [
  'ai',
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
  'sync',
  'users',
  'webhooks',
] as const;

describe('@openlinker/core/<context> barrel purity (#598)', () => {
  it.each(CONTEXT_BARRELS)('imports @openlinker/core/%s without throwing', (context) => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const mod = require(`../${context}`) as Record<string, unknown>;
      expect(mod).toBeTruthy();
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    }).not.toThrow();
  });
});
