/**
 * @openlinker/integrations-ksef/testing — test-double sub-barrel
 *
 * Plugin-internal test doubles for the KSeF plugin (#1144), consumed only from
 * `*.spec.ts`: the in-memory `FakeKsefInvoicingAdapter`. Kept off the main
 * barrel because these are test-only — importing them from runtime code would
 * pull test logic into the bundle. The real test behaviour (call capture,
 * configurable responses) lands in C9.
 *
 * @module libs/integrations/ksef/src/testing
 */
export { FakeKsefInvoicingAdapter } from './testing/fake-ksef-invoicing.adapter';
