/**
 * @openlinker/integrations-subiekt-nexo/testing — test-double sub-barrel
 *
 * Plugin-internal test doubles for the Subiekt bridge (#754), consumed only
 * from `*.spec.ts`: the in-memory `FakeSubiektBridgeAdapter` and the shared
 * `runSubiektBridgeContractTests` fidelity suite (reusable by #753's real
 * client). Kept off the main barrel because these are test-only — importing
 * them from runtime code would pull test logic into the bundle.
 *
 * @module libs/integrations/subiekt-nexo/testing
 */
export { FakeSubiektBridgeAdapter } from './testing/fake-subiekt-bridge.adapter';
export {
  runSubiektBridgeContractTests,
  sampleBridgeBuyer,
  sampleIssueInvoiceRequest,
  sampleKorektaRequest,
  sampleUpsertCustomerRequest,
} from './testing/subiekt-bridge-contract.suite';
