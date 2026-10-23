/**
 * Price Change Derived-Filter Fixtures (#3162 re-review, IMPORTANT)
 *
 * **One table, consumed twice** — the `RETURN_STAGE_FIXTURES` precedent
 * (`libs/core/src/returns/testing/return-stage.fixtures.ts`) applied to a
 * smaller pair: `PriceChangeEpisode.direction()` / `.isSteep()` are
 * reproduced as SQL in `PriceChangeEpisodeRepository.applyDerivedFilters`
 * (`direction`/`magnitudeLargeOnly` filters), and nothing previously held the
 * two derivations to the same answer across an edit to either side — the
 * repository docblock claimed they matched "exactly", but a docblock is not
 * a mechanism.
 *
 * The TS unit spec (`price-change-episode.entity.spec.ts`) runs this table
 * through `PriceChangeEpisode.direction()`/`.isSteep()`; the integration spec
 * (`listings-price-change-episode.int-spec.ts`) inserts one episode per row
 * via `upsertOpen` and reads it back through
 * `PriceChangeEpisodeRepository.findOpenForConnection`'s `direction`/
 * `magnitudeLargeOnly` filters. A TS function over two numbers and a SQL
 * `WHERE` clause over two columns admit no textual equality — this is what
 * proves they agree on MEANING, which a structural mirror script cannot.
 *
 * The three boundary cases named in review are each their own row: a `null`
 * `computedOldAmount` (no baseline at all), a real `0` baseline (never the
 * `null` sentinel), and `|deltaPct|` landing on exactly the `10` threshold
 * from both sides.
 *
 * Lives on the `@openlinker/core/listings/testing` subpath, not the
 * production barrel — the `returns`/`identifier-mapping`/`integrations`/
 * `events`/`inventory` `/testing` sub-barrel convention, so a fixture cannot
 * be reached from runtime code by autocomplete.
 *
 * @module libs/core/src/listings/testing
 */
export interface PriceChangeDerivedFilterFixture {
  /** What the row demonstrates, in the operator's terms. */
  name: string;
  computedOldAmount: number | null;
  computedNewAmount: number;
  expectedDirection: 'up' | 'down' | 'unknown';
  expectedSteep: boolean;
}

export const PRICE_CHANGE_DERIVED_FILTER_FIXTURES: readonly PriceChangeDerivedFilterFixture[] = [
  {
    name: 'no baseline at all — a brand-new mapping\'s first detection',
    computedOldAmount: null,
    computedNewAmount: 430.5,
    expectedDirection: 'unknown',
    expectedSteep: false,
  },
  {
    name: 'a real zero baseline with a positive new amount is an increase, never "down"',
    computedOldAmount: 0,
    computedNewAmount: 100,
    expectedDirection: 'up',
    expectedSteep: false, // deltaPct() is 0 here — the zero-baseline sentinel, never steep
  },
  {
    name: 'equal old and new — direction reads "up", never "down", at zero delta',
    computedOldAmount: 100,
    computedNewAmount: 100,
    expectedDirection: 'up',
    expectedSteep: false,
  },
  {
    name: 'a small increase, well under the steep threshold',
    computedOldAmount: 100,
    computedNewAmount: 105,
    expectedDirection: 'up',
    expectedSteep: false, // +5.0%
  },
  {
    name: 'an increase landing exactly on the steep threshold',
    computedOldAmount: 100,
    computedNewAmount: 110,
    expectedDirection: 'up',
    expectedSteep: true, // +10.0%, |deltaPct| >= 10
  },
  {
    name: 'an increase one unit short of the steep threshold',
    computedOldAmount: 100,
    computedNewAmount: 109,
    expectedDirection: 'up',
    expectedSteep: false, // +9.0%
  },
  {
    name: 'a small decrease, well under the steep threshold',
    computedOldAmount: 100,
    computedNewAmount: 95,
    expectedDirection: 'down',
    expectedSteep: false, // -5.0%
  },
  {
    name: 'a decrease landing exactly on the steep threshold',
    computedOldAmount: 100,
    computedNewAmount: 90,
    expectedDirection: 'down',
    expectedSteep: true, // -10.0%, |deltaPct| >= 10
  },
  {
    name: 'a decrease one unit short of the steep threshold',
    computedOldAmount: 100,
    computedNewAmount: 91,
    expectedDirection: 'down',
    expectedSteep: false, // -9.0%
  },
];
