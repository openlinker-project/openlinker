/**
 * @openlinker/integrations-inpost/testing — test-only sub-barrel
 *
 * Exposes `FakeInpostShippingAdapter` (#765) for plugin-author / consumer unit
 * tests that need an in-memory `ShippingProviderManagerPort` without hitting
 * sandbox ShipX. Consumed only from `*.spec.ts`, never from runtime code.
 *
 * @module libs/integrations/inpost/src
 */
export { FakeInpostShippingAdapter } from './testing/fake-inpost-shipping.adapter';
