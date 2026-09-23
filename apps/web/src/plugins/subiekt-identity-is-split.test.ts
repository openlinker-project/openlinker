/**
 * Guard: Subiekt GT and Subiekt nexo never share an identity.
 *
 * They are two separate InsERT products reached through two different bridges
 * with different wire contracts - four of the routes the GT adapter calls do
 * not exist on the nexo bridge at all. Only GT has an adapter here today, and
 * if a nexo one is ever built it must register its OWN `id` and its OWN
 * `platformType`, never share GT's and never revive the bare legacy `'subiekt'`
 * that could not tell them apart.
 *
 * This is deliberately a SEPARATE file from `subiekt-gt/subiekt.test.ts`. That
 * one asserts what the GT plugin is; this one asserts what NO plugin may be,
 * which is a claim about the registry rather than about one member of it - so
 * it keeps holding when a second Subiekt plugin appears, which is exactly the
 * moment it matters.
 *
 * The backend half of the same rule lives in
 * `libs/integrations/subiekt/src/__tests__/subiekt-identity-is-split.spec.ts`.
 * Both halves are needed: the browser cannot import `@openlinker/core` (#591),
 * so the FE literals are a mirror, and a mirror that drifts fails silently at
 * connection-create time rather than at boot or at type-check.
 *
 * @module plugins
 */
import { describe, expect, it } from 'vitest';
import { plugins } from './index';

/**
 * The identity the bare `'subiekt'` was split into. A future nexo plugin adds
 * its own value here (e.g. `'subiekt-nexo'`) - it does NOT get added to the
 * legacy list below, and it does not reuse this one.
 */
const SUBIEKT_GT_PLATFORM_TYPE = 'subiekt-gt';

/**
 * Values that must never come back. `'subiekt'` is ambiguous between two
 * products; `'subiekt.invoicing.v1'` named a fifth of what the adapter does.
 */
const RETIRED_IDENTITIES = ['subiekt', 'subiekt.invoicing.v1'];

describe('Subiekt identity is split (GT vs nexo)', () => {
  it('registers Subiekt GT under its own platformType', () => {
    // Deliberately a `find`, not a count. An earlier version asserted that
    // exactly ONE Subiekt-family plugin exists, which would have failed the
    // day somebody added the nexo plugin - the very future this file's header
    // promises to allow. Uniqueness of the platformType is a separate
    // question, and the third test below is the one that asks it.
    const subiektGt = plugins.find(
      (plugin) => plugin.platformType === SUBIEKT_GT_PLATFORM_TYPE
    );

    expect(subiektGt).toBeDefined();
    expect(subiektGt?.id).toBe(SUBIEKT_GT_PLATFORM_TYPE);
  });

  it('never registers a plugin under a retired Subiekt identity', () => {
    for (const plugin of plugins) {
      expect(RETIRED_IDENTITIES).not.toContain(plugin.platformType);
      expect(RETIRED_IDENTITIES).not.toContain(plugin.id);
    }
  });

  it('gives each Subiekt-family plugin a distinct platformType', () => {
    // Vacuous with one Subiekt plugin, load-bearing with two: a nexo plugin
    // copy-pasted from GT would otherwise silently shadow it in
    // `usePlatform(platformType)`, which resolves by first match.
    const subiektTypes = plugins
      .map((plugin) => plugin.platformType)
      .filter((platformType): platformType is string =>
        platformType?.startsWith('subiekt') ?? false
      );

    expect(new Set(subiektTypes).size).toBe(subiektTypes.length);
  });

  it('routes Subiekt GT setup to its own path', () => {
    const subiektGt = plugins.find(
      (plugin) => plugin.platformType === SUBIEKT_GT_PLATFORM_TYPE
    );

    // A shared `/connections/new/subiekt` path would send an operator who
    // picked one product to the other product's wizard.
    expect(subiektGt?.platform?.setupCard?.to).toBe('/connections/new/subiekt-gt');
  });
});
