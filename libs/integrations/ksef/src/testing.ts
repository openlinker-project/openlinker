/**
 * @openlinker/integrations-ksef/testing — test-double sub-barrel
 *
 * Plugin-internal test doubles for the KSeF plugin (#1144), consumed only from
 * `*.spec.ts`: the in-memory `FakeKsefInvoicingAdapter` (C2), plus the C3
 * transport/auth doubles `FakeKsefHttpClient` and `FakeKsefAuthHandshakeService`.
 * Kept off the main barrel because these are test-only — importing them from
 * runtime code would pull test logic into the bundle.
 *
 * @module libs/integrations/ksef/src/testing
 */
export { FakeKsefInvoicingAdapter } from './testing/fake-ksef-invoicing.adapter';
export { FakeKsefHttpClient } from './testing/fake-ksef-http-client';
export { FakeKsefAuthHandshakeService } from './testing/fake-ksef-auth.service';
export {
  generateTestSigningMaterial,
  signXadesForTest,
  verifyXadesForTest,
  type TestSigningMaterial,
} from './testing/test-xades-signer';
