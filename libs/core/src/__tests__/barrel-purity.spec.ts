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
  'automation',
  'catalog-trust',
  'content',
  'customers',
  'events',
  'fulfillment',
  'fulfillment-authority',
  'identifier-mapping',
  'integrations',
  'inventory',
  'listings',
  'mappings',
  'order-lifecycle',
  'orders',
  'products',
  'returns',
  'sales-documents',
  'sync',
  'users',
  'webhooks',
] as const;

/**
 * Extracts every module-specifier-bearing statement from an already-
 * comment-stripped source, as `[typeOnly, specifier]` pairs.
 *
 * **Both `import … from` AND `export … from` are matched (#2441 review I-3).**
 * Anchoring on the literal `import` alone left the guarantee evadable: a leaf's
 * `index.ts` doing `export * from '@openlinker/core/orders';` emits a real
 * `require()` and closes exactly the CJS cycle this spec is the sole guard
 * against — while matching nothing and passing. That is not a hypothetical
 * shape, either: every one of these leaves' `index.ts` files is composed
 * entirely of `export … from` statements (relative ones today), so the evasion
 * is one specifier edit away from the file's own prevailing style.
 *
 * Group 1 captures `type ` when present, so `export type { X } from …` is
 * correctly classified type-only alongside `import type { X } from …`.
 * `[^'";]*?` cannot cross a quote or semicolon, so a match never spans into an
 * unrelated later statement.
 *
 * Note the INLINE type form — `import { type OrderStatus } from '…'` — is
 * classified as a VALUE import and therefore fails. That is the safe direction
 * (a false positive, never a false negative), but it does mean the repo's
 * inline-type style cannot be used inside a leaf: write `import type { … }`.
 *
 * **The BARE side-effect form is matched too (#2675 review).** `import
 * '@openlinker/core/products';` carries no clause and no `from`, so the
 * `from`-anchored alternative above saw nothing and the leaf assertion passed
 * — while the statement emits an unconditional `require()` and closes exactly
 * the CJS cycle this spec is the sole guard against. It is strictly worse than
 * the #2441 `export … from` evasion it sits beside: that one at least binds a
 * symbol somebody might notice in review, whereas this one is a single line
 * that reads as an ordinary import and pulls the whole sibling barrel in. A
 * side-effect import can never be type-only, so it is always classified as a
 * VALUE import (`typeOnly` undefined) and is therefore forbidden
 * unconditionally, allow-set or not. The two alternatives cannot overlap:
 * `[^'";]*?` cannot cross a quote, so the `from`-anchored branch can never
 * start at a bare `import '…'` and then reach a LATER statement's `from`.
 */
const findModuleSpecifierStatements = (
  withoutComments: string
): Array<[typeOnly: string | undefined, specifier: string]> =>
  [
    ...withoutComments.matchAll(
      /(?:import|export)\s+(type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g
    ),
  ].map(([, typeOnly, fromSpecifier, bareSpecifier]) => [
    typeOnly,
    fromSpecifier ?? bareSpecifier,
  ]);

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
   * ## Zero-sibling-edge leaves
   *
   * Some concerns exist precisely because they depend on almost NOTHING among
   * their CORE siblings. `sales-documents` (#2100) was the first: `invoicing`
   * and `orders` both value-import it, and `invoicing` would close a CJS
   * module-load cycle the moment the leaf grew a VALUE edge back into either.
   * ADR-053 then adopted that posture deliberately for the OMS vocabulary
   * leaves; `fulfillment` (#2391) joins them, so after that change there are
   * four. Before this assertion nothing enforced the
   * property, so a future `import` would have been caught only by a Nest boot
   * failure in some unrelated suite.
   *
   * **The property is ZERO SIBLING-CONTEXT EDGES, not framework-freedom** —
   * two different things, and only the second is what prevents the cycle.
   * #2170 proved the distinction: `sales-documents` gained a NestJS module,
   * repositories and ORM entities and remained a valid leaf, because nothing
   * under it imports a `@openlinker/core/<ctx>` specifier. `@nestjs/*`,
   * `typeorm` and Node builtins (`node:*`) are therefore unrestricted; only a
   * non-relative specifier starting with `@openlinker/core/` is checked below.
   * A leaf that later grows a module or a tokens file does not leave this table.
   *
   * Textual, deliberately: a `require()` cannot see whether the module pulled a
   * dependency in, and the whole point is to forbid a VALUE import statement.
   *
   * ## Adding a leaf
   *
   * One line in `ZERO_SIBLING_EDGE_LEAVES` below — the context directory name
   * plus its authorized type-only specifiers. Nothing else changes: the walk,
   * the matcher and the assertions are shared.
   *
   * ## Per-leaf carve-outs, and why the allow-set is NOT shared
   *
   * A type-only import ERASES at compile time — there is no `require()` call in
   * the emitted JS, so it adds no runtime edge and cannot close the cycle this
   * spec exists to forbid. Three leaves hold such a carve-out — two naming the
   * same specifier — but they are registered SEPARATELY on purpose. A
   * single shared constant would silently authorise one leaf's future exception
   * for every other leaf; each entry is a statement about its own leaf.
   *
   * - `sales-documents` (#2155): `resolveSalesDocumentRouting` takes `Order` as
   *   a caller-supplied value parameter (ADR-041 decision 2), typed via
   *   `import type { Order } from '@openlinker/core/orders/types'`.
   * - `order-lifecycle` (#2305, ADR-059): `phaseToOrderStatus` and
   *   `deriveOrderLifecyclePhase` borrow `OrderStatus` / `OrderRecordStatus` /
   *   `FulfillmentRollupState` from the same cycle-breaker sub-barrel.
   *   Restating those unions locally was considered and rejected — two sources
   *   of truth for a transport vocabulary is the drift the mapping prevents.
   * - `fulfillment-authority` (#2304, ADR-052/053): **empty allow-set, and that
   *   is a positive assertion.** It reaches no sibling at all today, and its
   *   first type-only import must be a deliberate one-line registration here,
   *   never a free ride on a neighbour's carve-out.
   * - `fulfillment` (#2391, ADR-053/054): `FulfillmentWork.cancellationReason`
   *   is typed by `FulfillmentCancellationReason`, which already ships in the
   *   `fulfillment-authority` leaf (#2304). Restating that union locally is the
   *   duplication ADR-053 § Alternatives rejects by name.
   *   **Second specifier (#2392)**: `FulfillmentHold.reason` is typed by
   *   `HoldReason` from the `order-lifecycle` leaf (#2305). Design adjudication
   *   #4 keeps ONE hold-reason vocabulary across the two hold grains (order and
   *   work), so this is the same anti-duplication argument, not a widening of
   *   it — each specifier is registered on its own merits. Note the leaf can
   *   borrow the TYPE but not the `isHoldReason` GUARD: a guard is a value
   *   import, which the assertion below forbids unconditionally, so
   *   `FulfillmentWorkRepository` casts that column at the boundary (the
   *   `ReturnLine.custodyState` precedent) rather than narrowing it.
   *
   * Two of the three authorized specifiers are a `…/types` cycle-breaker
   * sub-barrel. `fulfillment`'s is the first **main** `@openlinker/core/<ctx>`
   * barrel authorized here, and it is admissible only because BOTH of the
   * following hold — a main barrel is otherwise forbidden, since it re-exports
   * the context's NestJS module and would reintroduce exactly the cycle risk
   * this table exists to avoid if such an import were ever (incorrectly) turned
   * into a value import:
   *
   *   1. the import is type-only, so it erases and creates no runtime edge; and
   *   2. the TARGET is itself registered in this table as a zero-sibling-edge
   *      leaf that exports no NestJS module.
   *
   * Condition 2 is a fact about `fulfillment-authority` TODAY, and ADR-053 calls
   * its framework-freedom a starting posture rather than a vow. If that leaf
   * ever gains a module, this authorization's stated reason expires: re-derive
   * it, or give that leaf a `…/types` sub-barrel and point this entry at it.
   */
  const ZERO_SIBLING_EDGE_LEAVES = [
    {
      context: 'sales-documents',
      // #2515 (ADR-065) adds two to the original `orders/types` carve-out, on
      // the identical principle: the neutral per-order sales-document
      // projection must name the EXISTING invoice and fiscal status
      // vocabularies rather than declare a third one, and both are reached
      // type-only through dedicated cycle-breaker sub-barrels that re-export
      // no runtime value at all. Same erasure, same absent `require()`.
      authorizedTypeOnlySpecifiers: [
        '@openlinker/core/orders/types',
        '@openlinker/core/invoicing/types',
        '@openlinker/core/fiscalization/types',
      ],
    },
    { context: 'fulfillment-authority', authorizedTypeOnlySpecifiers: [] },
    { context: 'order-lifecycle', authorizedTypeOnlySpecifiers: ['@openlinker/core/orders/types'] },
    {
      context: 'fulfillment',
      authorizedTypeOnlySpecifiers: [
        '@openlinker/core/fulfillment-authority',
        '@openlinker/core/order-lifecycle',
      ],
    },
  ] as const;

  it.each(ZERO_SIBLING_EDGE_LEAVES)(
    '$context stays a zero-outbound-CORE-CONTEXT-edge leaf (only its own authorized type-only imports reach a sibling context)',
    ({ context, authorizedTypeOnlySpecifiers }) => {
      const root = join(__dirname, '..', context);
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(full);
        }
      };
      walk(root);

      // An empty walk must FAIL, not vacuously pass — a renamed or moved
      // directory would otherwise silently retire the leaf's guarantee.
      expect(files.length).toBeGreaterThan(0);

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
        // through. `findModuleSpecifierStatements` additionally covers
        // `export ... from` re-exports — see its docblock for why anchoring on
        // the literal `import` alone left the guarantee evadable (#2441 I-3).
        for (const [typeOnly, specifier] of findModuleSpecifierStatements(withoutComments)) {
          // Internal to the concern (index.ts's own `export * from './domain/...'`,
          // and any relative reach from a nested file back up to `domain/types/`)
          // — cannot reach another context either way.
          if (specifier.startsWith('./') || specifier.startsWith('../')) {
            continue;
          }
          // #2170: a leaf need not be framework-free, and that is NOT what this
          // spec guards against. Only a sibling `@openlinker/core/<ctx>` edge
          // can close the CJS cycle a consumer's value-import depends on
          // staying open; `@nestjs/*`, `typeorm`, `node:*`, etc. are ordinary
          // infrastructure dependencies every other context has too.
          if (!specifier.startsWith('@openlinker/core/')) {
            continue;
          }
          // Both assertions below carry the leaf AND the file in the compared
          // value, so a CI failure is actionable without a rerun.
          const located = `${context} :: ${file} :: ${specifier}`;
          // A VALUE import of a sibling context would close a real CJS
          // require() cycle the moment any consumer value-imports this leaf —
          // forbidden unconditionally, regardless of specifier or allow-set.
          expect(typeOnly ? located : `FORBIDDEN VALUE IMPORT — ${located}`).toBe(located);
          // …and even a type-only import must be one THIS leaf registered.
          // `toContain` over an empty allow-set fails every specifier, which is
          // precisely what `fulfillment-authority`'s `[]` asserts.
          expect(
            authorizedTypeOnlySpecifiers.map(
              (authorized) => `${context} :: ${file} :: ${authorized}`
            )
          ).toContain(located);
        }
      }
    }
  );

  /**
   * The evasion the matcher used to permit (#2441 review I-3).
   *
   * Fed the exact shape a leaf's `index.ts` already has — a file composed
   * entirely of `export … from` statements — the pre-fix matcher, anchored on
   * the literal `import`, saw NOTHING. So a one-word edit turning a relative
   * re-export into `export * from '@openlinker/core/products'` emitted a real
   * `require()`, closed the CJS cycle, and passed the spec that exists solely
   * to forbid it.
   *
   * Asserted on the matcher itself rather than by writing a file into a leaf
   * directory: the walk reads from disk, so a fixture-based version would have
   * to mutate real source and restore it, which fails dirty. The pairing below
   * is the whole property — the relative re-exports are ignored, the sibling
   * one is caught, and the type-only one is still classified type-only so the
   * per-leaf allow-set stays the thing that decides it.
   */
  it('the matcher sees `export ... from` re-exports, not just imports (#2441)', () => {
    const leafBarrelShape = [
      "export * from './domain/types/order-lifecycle-phase.types';",
      "export { deriveOrderLifecyclePhase } from './domain/types/order-lifecycle-phase.types';",
      "export * from '@openlinker/core/products';",
      "export type { Order } from '@openlinker/core/orders/types';",
      // The second evasion (#2675 review): no clause, no `from`, a real
      // `require()`. Must be seen, and must be seen as a VALUE import.
      "import '@openlinker/core/inventory';",
      // …and it must not swallow, or be swallowed by, the statement after it.
      "import { Trailing } from './trailing';",
    ].join('\n');

    expect(findModuleSpecifierStatements(leafBarrelShape)).toEqual([
      [undefined, './domain/types/order-lifecycle-phase.types'],
      [undefined, './domain/types/order-lifecycle-phase.types'],
      // The evasion — a VALUE re-export of a sibling context, now visible.
      [undefined, '@openlinker/core/products'],
      // …and `export type { … } from` is still correctly type-only.
      ['type ', '@openlinker/core/orders/types'],
      [undefined, '@openlinker/core/inventory'],
      [undefined, './trailing'],
    ]);
  });

  /**
   * The root `.` barrel (`libs/core/src/index.ts`) is an AGGREGATING re-export:
   * requiring it evaluates `orders`, `listings` and every other listed context
   * in one module graph. A zero-sibling-edge leaf whose entire value is that it
   * can be value-imported without closing a cycle gains nothing by joining that
   * aggregate, and takes on the exact hazard it exists to avoid the day some
   * consumer reaches for the root path — the reasoning that kept `ListingsModule`
   * off the main `@openlinker/core/listings` barrel (#337/#359).
   * `sales-documents` has been absent since #2100; #2308 removed
   * `order-lifecycle`, which #2305 had added. The root barrel is not an
   * inventory of contexts either way (several are legitimately absent), so
   * "completeness" argues for neither side.
   *
   * Each leaf keeps its own `@openlinker/core/<ctx>` subpath export — a
   * declared public path, and the supported way to consume it.
   */
  it('no zero-sibling-edge leaf is re-exported from the aggregating root barrel', () => {
    const rootBarrel = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    for (const { context } of ZERO_SIBLING_EDGE_LEAVES) {
      expect([context, rootBarrel.includes(`'./${context}'`)]).toEqual([context, false]);
    }
  });

  /**
   * The mirror of the assertion above, for the OTHER half of the same cycle.
   *
   * `orders.module.ts` value-imports `@openlinker/core/invoicing`, and the main
   * `@openlinker/core/orders` barrel re-exports `OrdersModule`. So a VALUE
   * import of that main barrel from anywhere inside `invoicing` closes
   * `invoicing -> orders -> invoicing` at module-load time. This is not
   * hypothetical: #2599 shipped exactly that import, having already added both
   * functions it needed to the `orders/types` cycle-breaker sub-barrel, and no
   * invariant in the repo objected. `check-cross-context-imports.mjs` allows
   * `is*` / entity / pure-constant shapes without looking at whether the import
   * is a value import of a module-exporting barrel, and the leaf assertion above
   * only walks `sales-documents`.
   *
   * Type-only imports of the main barrel stay allowed: they erase, so they add
   * no runtime edge. A value import must come from `@openlinker/core/orders/types`.
   */
  it('invoicing never VALUE-imports the main @openlinker/core/orders barrel (#2599)', () => {
    const root = join(__dirname, '..', 'invoicing');
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

    const offenders: string[] = [];
    for (const file of files) {
      const withoutComments = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, '');
      const statements = [
        ...withoutComments.matchAll(/import\s+(type\s+)?([^'";]*?)from\s+['"]([^'"]+)['"]/g),
      ];
      for (const [, typeOnly, clause, specifier] of statements) {
        if (specifier !== '@openlinker/core/orders') continue;
        if (typeOnly) continue;
        // `import { type Order } from ...` — an inline-type-only clause also
        // erases entirely, so it is as safe as a statement-level `import type`.
        const bindings = (clause.match(/\{([\s\S]*)\}/)?.[1] ?? '')
          .split(',')
          .map((b) => b.trim())
          .filter((b) => b.length > 0);
        const hasValueBinding =
          bindings.length === 0 || bindings.some((b) => !b.startsWith('type '));
        if (hasValueBinding) {
          offenders.push(`${file}: import ${clause.trim()} from '${specifier}'`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
