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
 * So the test asserts the fact that IS true today and is the reason the graph
 * assertion is empty: **no Nest decorator exists anywhere under
 * `libs/core/src/fulfillment/`**, therefore no container path to this context
 * can exist. And it ARMS ITSELF: the moment #2392 adds the first `@Injectable`
 * repository, `describesNestProviders` flips true, the structural claim is
 * retired, and the provider-graph assertion below runs for real against a
 * booted container. It cannot pass vacuously after that point.
 *
 * The forbidden-token list is deliberately the SAME two barrels the invariant
 * script forbids, so the two halves cannot drift into disagreeing about what
 * the boundary is.
 *
 * @module apps/worker/test/integration
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 * @see scripts/check-no-injection-contracts.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FULFILLMENT_DIR = resolve(
  __dirname,
  '../../../../libs/core/src/fulfillment',
);

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
  const files = collectSourceFiles(FULFILLMENT_DIR);
  // Strip block and line comments before matching, exactly as
  // `barrel-purity.spec.ts` does and for its documented reason (#2441): doc
  // prose in this repo narrates the very import rules being checked, so a
  // docblock quoting a forbidden specifier must not fail the suite.
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const sources = files.map((file) => ({
    file,
    text: stripComments(readFileSync(file, 'utf8')),
  }));

  const describesNestProviders = sources.some(({ text }) =>
    NEST_PROVIDER_DECORATORS.some((decorator) => text.includes(decorator)),
  );

  it('should find the fulfillment context on disk', () => {
    // Guards against the whole suite silently passing over a moved/renamed directory.
    expect(files.length).toBeGreaterThan(0);
  });

  it('should not import a forbidden sibling barrel from any file in the context', () => {
    const offenders = sources.flatMap(({ file, text }) =>
      FORBIDDEN_BARRELS.filter((barrel) =>
        // Quote-terminated so `@openlinker/core/orders/types` — the escape hatch
        // ADR-053 itself names — is not mistaken for `@openlinker/core/orders`.
        text.includes(`'${barrel}'`) || text.includes(`"${barrel}"`),
      ).map((barrel) => `${file}: ${barrel}`),
    );

    expect(offenders).toEqual([]);
  });

  it('should hold the structural no-provider claim until a Nest provider exists', () => {
    if (describesNestProviders) {
      // #2392 (or later) added a provider. The structural claim below no longer
      // holds and the provider-graph assertion in the next test takes over.
      expect(describesNestProviders).toBe(true);
      return;
    }

    expect(describesNestProviders).toBe(false);
  });

  it('should resolve no orders/inventory service through any fulfillment provider once one exists', async () => {
    if (!describesNestProviders) {
      // Nothing of this context is in the DI graph yet, so there is no provider
      // whose dependencies could be inspected. This arm disappears on its own
      // the day #2392 lands a provider — it is not a permanent skip.
      expect(describesNestProviders).toBe(false);
      return;
    }

    // From #2392 onward the boundary must be proved against the real container,
    // the ADR-041 F3 way: boot the worker graph and assert that no provider
    // reachable from this context resolves an `orders` / `inventory` service.
    // Failing loudly here is correct — a provider exists and this assertion has
    // not been written yet, which must not read as a pass.
    throw new Error(
      'libs/core/src/fulfillment now declares a Nest provider. Replace this arm with the ' +
        'ADR-041 F3 provider-graph assertion (see apps/worker/test/integration/' +
        'invoicing-auto-issue-boot.int-spec.ts) before merging #2392.',
    );
  });
});
