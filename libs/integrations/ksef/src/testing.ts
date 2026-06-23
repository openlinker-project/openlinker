/**
 * @openlinker/integrations-ksef/testing — test-double sub-barrel
 *
 * Plugin-internal test doubles for the KSeF plugin (#1144), consumed only from
 * `*.spec.ts`: the in-memory `FakeKsefInvoicingAdapter` (C2), the C3
 * transport/auth doubles `FakeKsefHttpClient` and `FakeKsefAuthHandshakeService`,
 * plus the C9 behavioural `FakeKsefClient` (an in-memory `IKsefHttpClient` state
 * machine) and the shared `runKsefHttpClientContract` suite both the fake and the
 * real client must satisfy.
 * Kept off the main barrel because these are test-only — importing them from
 * runtime code would pull test logic into the bundle.
 *
 * @module libs/integrations/ksef/src/testing
 */
export { FakeKsefInvoicingAdapter } from './testing/fake-ksef-invoicing.adapter';
export { FakeKsefHttpClient } from './testing/fake-ksef-http-client';
export { FakeKsefAuthHandshakeService } from './testing/fake-ksef-auth.service';
export {
  FakeKsefClient,
  FAKE_KSEF_STATUS,
  type FakeKsefClientOptions,
  type FakeKsefFailureMode,
} from './testing/fake-ksef-client';
export {
  runKsefHttpClientContract,
  type KsefClientContractOptions,
} from './testing/ksef-client-contract.suite';
export {
  generateTestSigningMaterial,
  signXadesForTest,
  verifyXadesForTest,
  type TestSigningMaterial,
} from './testing/test-xades-signer';
