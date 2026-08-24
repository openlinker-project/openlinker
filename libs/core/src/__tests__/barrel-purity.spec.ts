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
  'fulfillment-authority',
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
   * `sales-documents` (#2100) is the one context whose value is that it depends
   * on almost NOTHING among its CORE siblings: `invoicing` and `orders` both
   * value-import it, and `invoicing` would close a CJS module-load cycle the
   * moment this leaf grew a VALUE edge back into either. Three docblocks call
   * that load-bearing; before this assertion nothing enforced it, so a future
   * `import` here would have been caught only by a Nest boot failure in some
   * unrelated suite.
   *
   * **Narrowed by #2170** (see `sales-documents/index.ts`'s own doc comment):
   * the concern gained a NestJS module + repositories + ORM entities, so it is
   * no longer framework-free — but it must stay a zero-outbound-edge leaf with
   * respect to sibling `@openlinker/core/<ctx>` barrels specifically. Those are
   * two different properties ("no framework dependency" vs. "no sibling-context
   * dependency"), and only the second is what prevents the CJS cycle. `@nestjs/*`,
   * `typeorm`, and Node builtins (`node:*`) are therefore unrestricted; only a
   * non-relative specifier starting with `@openlinker/core/` is checked below.
   *
   * Textual, deliberately: a `require()` cannot see whether the module pulled a
   * dependency in, and the whole point is to forbid a VALUE import statement.
   *
   * #2155 carved out ONE authorized exception: `resolveSalesDocumentRouting`
   * takes `Order` as a caller-supplied value parameter (ADR-041 decision 2),
   * typed via `import type { Order } from '@openlinker/core/orders/types'`. A
   * type-only import ERASES at compile time — there is no `require()` call in
   * the emitted JS, so it adds no runtime edge and cannot close the cycle this
   * spec exists to forbid. Any OTHER `@openlinker/core/*` import — a value
   * import of anything, or a type-only import from any specifier other than
   * that one cycle-breaker sub-barrel — still fails this spec.
   */
  it('sales-documents stays a zero-outbound-CORE-CONTEXT-edge leaf (only the one authorized type-only import reaches a sibling context)', () => {
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

    const AUTHORIZED_TYPE_ONLY_SPECIFIER = '@openlinker/core/orders/types';

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Doc comments in this repo's style routinely narrate the very import
      // rule being checked (e.g. "typed via `import type` from the
      // cycle-breaker … sub-barrel"), in prose that itself contains the bare
      // words "import" and "from" with no quote/semicolon between them. A
      // matcher run over the raw source would let such prose masquerade as
      // (or worse, splice onto) a real import statement, so block AND line
      // comments are stripped first — over-broad stripping is safe here
      // (the source is scanned for import shape only, never executed).
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
      // Scanned over the WHOLE (comment-stripped) file, not line by line: a
      // multi-line `import type {\n  X,\n} from '…'` — the prevailing style in
      // this repo, and exactly what an edit here would produce — puts `import`
      // and `from` on different lines, so a per-line matcher would let it
      // through. Captures whether the statement is `import type ...` (group 1)
      // and its specifier (group 2); `[^'";]*?` cannot cross a quote or
      // semicolon, so it never accidentally spans into an unrelated later
      // import.
      const importStatements = [
        ...withoutComments.matchAll(/import\s+(type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]/g),
      ];
      for (const [, typeOnly, specifier] of importStatements) {
        // Internal to the concern (index.ts's own `export * from './domain/...'`,
        // and any relative reach from a nested file back up to `domain/types/`)
        // — cannot reach another context either way.
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          continue;
        }
        // #2170: the concern is no longer framework-free (NestJS module +
        // TypeORM repositories), and that is fine — it is NOT what this spec
        // guards against. Only a sibling `@openlinker/core/<ctx>` edge can
        // close the CJS cycle `invoicing`/`orders` value-importing this leaf
        // depends on staying open; `@nestjs/*`, `typeorm`, `node:*`, etc. are
        // ordinary infrastructure dependencies every other context has too.
        if (!specifier.startsWith('@openlinker/core/')) {
          continue;
        }
        // A VALUE import of a sibling context would close a real CJS
        // require() cycle the moment any consumer value-imports this leaf —
        // forbidden unconditionally, regardless of specifier.
        expect(typeOnly).toBeTruthy();
        // The ONLY authorized cross-context type this concern may borrow, and
        // ONLY from the cycle-breaker sub-barrel — never the main
        // `@openlinker/core/orders` barrel, which re-exports `OrdersModule` and
        // would reintroduce exactly the cycle risk decision 2 exists to avoid
        // if this import were ever (incorrectly) turned into a value import.
        expect(specifier).toBe(AUTHORIZED_TYPE_ONLY_SPECIFIER);
      }
    }
  });
});
