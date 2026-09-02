/**
 * Fulfillment No-Injection Boundary — boot integration test (#2391, ADR-053)
 *
 * Epic #2412 § Boundary rule: the `fulfillment` context injects **no**
 * `orders` / `inventory` service. Order data enters as arguments; a type need
 * goes through `@openlinker/core/orders/types`.
 *
 * ## Why this test exists at all
 *
 * `scripts/check-no-injection-contracts.mjs` is a SOURCE-TEXT scan, and its own
 * header says so: it cannot see `ModuleRef.get(TOKEN, { strict: false })`, which
 * acquires a service with no import statement anywhere. That idiom is already
 * live in this codebase — `InvoiceService` uses exactly it to avoid a module
 * cycle — so the guard is the necessary-but-insufficient half, and this file is
 * the complement. The precedent is ADR-041's F3 test,
 * `invoicing-auto-issue-boot.int-spec.ts`, which observes the RESOLVED PROVIDER
 * GRAPH rather than the import text.
 *
 * ## Why it asserts what it does, and not the obvious thing
 *
 * The obvious assertion — boot the container, resolve the fulfillment
 * providers, prove none of them holds an `orders`/`inventory` service — has **no
 * subject in this slice**. #2391 ships a vocabulary leaf: no `@Module`, no
 * `@Injectable`, no provider, no token. Nothing of this context is in the
 * container graph at all, so a provider-graph assertion would pass while
 * asserting nothing, and the only way to see it fail would be to inject into a
 * provider written for the test and then deleted — a green suite whose sole red
 * demonstration is against code that never merges.
 *
 * #2391 therefore asserted the fact that WAS true then — no Nest decorator
 * anywhere under `libs/core/src/fulfillment/`, so no container path could exist
 * — and armed itself: the moment a provider appeared, `describesNestProviders`
 * flipped true and the placeholder arm threw, naming this replacement.
 *
 * ## Since #2392, the boundary is proved three ways against a real container
 *
 * That arm is gone and the graph assertion runs for real:
 *
 *  1. the container BOOTS and `FULFILLMENT_WORK_REPOSITORY_TOKEN` resolves —
 *     which catches a missing export, an unprovided repository, or a CommonJS
 *     require cycle, none of which any unit suite or static scan can see;
 *  2. `FulfillmentModule`'s `imports` metadata names neither `OrdersModule` nor
 *     `InventoryModule` — a module edge is how a service would actually become
 *     injectable, and no import statement need exist for one;
 *  3. no provider `FulfillmentModule` declares injects a token whose name
 *     mentions Order or Inventory, read from the metadata Nest itself recorded.
 *
 * Each asserts a non-empty subject, so none can pass vacuously.
 *
 * The forbidden-token list is deliberately the SAME two barrels the invariant
 * script forbids, so the two halves cannot drift into disagreeing about what
 * the boundary is.
 *
 * @module apps/worker/test/integration
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 * @see scripts/check-no-injection-contracts.mjs
 */
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FULFILLMENT_WORK_REPOSITORY_TOKEN, FulfillmentModule } from '@openlinker/core/fulfillment';

import { getTestHarness, teardownTestHarness } from './setup';

const FULFILLMENT_DIR = resolve(__dirname, '../../../../libs/core/src/fulfillment');

/** The exact specifiers `scripts/check-no-injection-contracts.mjs` forbids. */
const FORBIDDEN_BARRELS = ['@openlinker/core/orders', '@openlinker/core/inventory'] as const;

/** Nest decorators whose presence would put this context into the DI graph. */
const NEST_PROVIDER_DECORATORS = ['@Injectable(', '@Module(', '@Global('] as const;

const collectSourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
};

describe('fulfillment context — ADR-053 no-injection boundary (#2391)', () => {
  beforeAll(() => {
    // Set BEFORE the container boots, and set here rather than relying on a
    // sibling spec — a boot gate that is run-order dependent is a boot gate you
    // cannot run to diagnose the boot it guards (the `oms-module-boot` /
    // `automation-dispatch-boot` precedent). Running this file alone via
    // `--runTestsByPath` is exactly the diagnostic path that matters for this
    // boundary, and without this it dies in `getPiiConfig` before reaching
    // anything this spec is about.
    process.env.OL_PII_HASH_SALT ??= 'test-salt-for-integration-tests';
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const files = collectSourceFiles(FULFILLMENT_DIR);
  // Strip comments before matching, in the same spirit as
  // `barrel-purity.spec.ts` and for its documented reason (#2441): doc prose in
  // this repo narrates the very import rules being checked, so a docblock
  // quoting a forbidden specifier must not fail the suite.
  //
  // Deliberately NARROWER than that sibling: only FULL-LINE `//` comments are
  // stripped, so a `//` inside a string literal is never truncated. The cost is
  // that a trailing `// '@openlinker/core/orders'` fails here and would pass
  // there — a false positive, which is the safe direction for a prohibition.
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const sources = files.map((file) => ({
    file,
    text: stripComments(readFileSync(file, 'utf8')),
  }));

  const describesNestProviders = sources.some(({ text }) =>
    NEST_PROVIDER_DECORATORS.some((decorator) => text.includes(decorator))
  );

  it('should find the fulfillment context on disk', () => {
    // Guards against the whole suite silently passing over a moved/renamed directory.
    expect(files.length).toBeGreaterThan(0);
  });

  it('should not import a forbidden sibling barrel from any file in the context', () => {
    const offenders = sources.flatMap(({ file, text }) =>
      FORBIDDEN_BARRELS.filter(
        (barrel) =>
          // Quote-terminated so `@openlinker/core/orders/types` — the escape hatch
          // ADR-053 itself names — is not mistaken for `@openlinker/core/orders`.
          text.includes(`'${barrel}'`) || text.includes(`"${barrel}"`)
      ).map((barrel) => `${file}: ${barrel}`)
    );

    expect(offenders).toEqual([]);
  });

  it('should resolve the fulfillment repository token from the real container', async () => {
    // #2392 landed the first provider, so the structural claim above has
    // retired and the boundary is now proved against a booted container — the
    // ADR-041 F3 shape (`invoicing-auto-issue-boot.int-spec.ts`). Resolving the
    // token at all is the half a unit suite cannot do: a missing export, an
    // unprovided repository, or a CommonJS require cycle between this context
    // and a sibling all fail here and nowhere else.
    expect(describesNestProviders).toBe(true);

    const harness = await getTestHarness();
    const repository = harness.get(FULFILLMENT_WORK_REPOSITORY_TOKEN);
    expect(repository).toBeDefined();
    expect(typeof (repository as { placeHold?: unknown }).placeHold).toBe('function');
  });

  it('should declare no orders/inventory module in the fulfillment module graph', () => {
    // The static scan cannot see a module edge, only an import statement, and a
    // module edge is how a service would actually become injectable here.
    const imported = (Reflect.getMetadata('imports', FulfillmentModule) ?? []) as unknown[];
    // A `DynamicModule` is a PLAIN OBJECT, not a class — `TypeOrmModule.forFeature`
    // is one, and this module's only import is exactly that. Rendering entries
    // with `String()` alone would turn every dynamic entry into
    // `"[object Object]"`, so `OrdersModule.forFeature(...)` or
    // `{ module: OrdersModule, ... }` would slip through the two assertions
    // below while a bare class import was caught.
    const importedNames = imported.map((entry) => {
      if (typeof entry === 'function') return entry.name;
      const dynamic = entry as { module?: { name?: string } } | null;
      return dynamic?.module?.name ?? String(entry);
    });

    // Non-vacuity: an empty `imports` would satisfy both `not.toContain`s while
    // asserting nothing about a module that had been emptied by accident.
    expect(importedNames.length).toBeGreaterThan(0);
    expect(importedNames).not.toContain('OrdersModule');
    expect(importedNames).not.toContain('InventoryModule');
  });

  it('should inject no orders/inventory service into any fulfillment provider', () => {
    // The complement to `check-no-injection-contracts.mjs`: this reads the
    // RESOLVED INJECTION METADATA Nest itself recorded, so it sees a dependency
    // acquired without a matching import statement — which a source-text scan
    // cannot. (`ModuleRef.get(TOKEN, { strict: false })` remains outside the
    // reach of both; the module-edge assertion above is what bounds it.)
    const providers = (Reflect.getMetadata('providers', FulfillmentModule) ?? []) as unknown[];
    const classProviders = providers.filter(
      (p): p is new (...args: never[]) => unknown => typeof p === 'function'
    );

    // A vacuous pass is the failure mode this whole file exists to avoid.
    expect(classProviders.length).toBeGreaterThan(0);

    const injected = classProviders.flatMap((provider) => {
      const custom = (Reflect.getMetadata('self:paramtypes', provider) ?? []) as {
        param: unknown;
      }[];
      const positional = (Reflect.getMetadata('design:paramtypes', provider) ?? []) as unknown[];
      return [...custom.map((entry) => entry.param), ...positional].map((token) => {
        if (typeof token === 'symbol') return token.description ?? String(token);
        if (typeof token === 'function') return token.name;
        return String(token);
      });
    });

    const forbidden = injected.filter((name) => /Order|Inventory/i.test(name));
    // Asserted as a list rather than a boolean so a failure names the token.
    expect(forbidden).toEqual([]);
  });
});
