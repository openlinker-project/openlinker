/**
 * Identifier-Mapping Testing Sub-Barrel
 *
 * Public surface for the in-memory fake. Consumed via the
 * `@openlinker/core/identifier-mapping/testing` package-exports subpath
 * (see `libs/core/package.json`). Plugin authors import from this barrel
 * in their `*.spec.ts` files; production code never reaches in here.
 *
 * @module libs/core/src/identifier-mapping/testing
 */
export { InMemoryIdentifierMappingAdapter } from './in-memory-identifier-mapping.adapter';
export type { InMemoryIdentifierMappingSeed } from './in-memory-identifier-mapping.adapter';
