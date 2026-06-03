/**
 * @openlinker/integrations-dpd-polska/testing — test-only sub-barrel
 *
 * Exposes `FakeDpdShippingAdapter` for plugin-author / consumer unit tests that
 * need an in-memory `ShippingProviderManagerPort` (+ `LabelDocumentReader`)
 * without hitting DPDServices. Consumed only from `*.spec.ts`, never from
 * runtime code.
 *
 * @module libs/integrations/dpd-polska/src
 */
export { FakeDpdShippingAdapter } from './testing/fake-dpd-shipping.adapter';
