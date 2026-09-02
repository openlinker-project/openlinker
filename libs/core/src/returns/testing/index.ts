/**
 * Returns — test-only exports (#2377)
 *
 * Consumed from `*.spec.ts` / `*.int-spec.ts` only, never from runtime code.
 * Kept off the production barrel so a fixture cannot be imported into a
 * controller by autocomplete — the convention the `identifier-mapping`,
 * `integrations`, `events` and `inventory` testing sub-barrels already follow.
 *
 * @module libs/core/src/returns/testing
 */
export { RETURN_STAGE_FIXTURES } from './return-stage.fixtures';
export type { ReturnStageFixture } from './return-stage.fixtures';
