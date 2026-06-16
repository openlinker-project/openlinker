/**
 * Subiekt Bridge — shared contract suite (fidelity seam)
 *
 * The happy-path behavioural contract every `SubiektBridgeClient` must satisfy.
 * Run it against the in-memory fake here, and — when they exist — against the
 * real HTTP client (#753) on a Windows CI job wired to a live bridge (#752).
 * One suite, two backends: if the fake and the real bridge ever disagree, the
 * suite goes red. This is the mitigation for the fake's fidelity-drift risk
 * (SWE@Google Ch. 13); failure-mode behaviour is fake-specific (driven by the
 * fake's `seedFailure` helper) and lives in the fake's own spec, not here.
 *
 * Uses ambient Jest globals (`describe`/`it`/`expect`) — call it from inside a
 * spec file.
 *
 * @module libs/integrations/subiekt/testing
 */
import type { SubiektBridgeClient } from '../bridge/subiekt-bridge.client';
import { BridgeRegulatoryStatusValues } from '../bridge/subiekt-bridge.types';
import type {
  BridgeBuyer,
  BridgeIssueInvoiceRequest,
} from '../bridge/subiekt-bridge.types';

/** A representative bridge buyer for contract / adapter tests. */
export function sampleBridgeBuyer(overrides: Partial<BridgeBuyer> = {}): BridgeBuyer {
  return {
    name: 'Przykład Sp. z o.o.',
    nip: '1234567890',
    isCompany: true,
    address: {
      line1: 'ul. Przykładowa 1',
      line2: null,
      city: 'Warszawa',
      postalCode: '00-001',
      countryCode: 'PL',
    },
    ...overrides,
  };
}

/** A representative issue-invoice request for contract / adapter tests. */
export function sampleIssueInvoiceRequest(
  overrides: Partial<BridgeIssueInvoiceRequest> = {},
): BridgeIssueInvoiceRequest {
  return {
    orderId: 'ol_order_sample',
    idempotencyKey: 'idem-sample',
    documentType: 'invoice',
    currency: 'PLN',
    buyer: sampleBridgeBuyer(),
    lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 123.0, taxRate: '23' }],
    ...overrides,
  };
}

/**
 * Register the shared contract tests against a `SubiektBridgeClient` factory.
 * `makeClient` is called once per test so each case starts from a fresh client.
 */
export function runSubiektBridgeContractTests(makeClient: () => SubiektBridgeClient): void {
  describe('SubiektBridgeClient contract', () => {
    let client: SubiektBridgeClient;

    beforeEach(() => {
      client = makeClient();
    });

    it('should issue a document with a provider id, number and a known regulatory status', async () => {
      const res = await client.issueInvoice(sampleIssueInvoiceRequest());
      expect(res.providerInvoiceId).toBeTruthy();
      expect(res.providerInvoiceNumber).toBeTruthy();
      expect(res.state).toBe('issued');
      expect(BridgeRegulatoryStatusValues).toContain(res.regulatoryStatus);
    });

    it('should upsert a customer and return a provider customer id', async () => {
      const res = await client.upsertCustomer({ buyer: sampleBridgeBuyer() });
      expect(res.providerCustomerId).toBeTruthy();
    });

    it('should read back the state of a just-issued document', async () => {
      const issued = await client.issueInvoice(sampleIssueInvoiceRequest());
      const status = await client.getInvoiceStatus({
        providerInvoiceId: issued.providerInvoiceId,
      });
      // `regulatoryStatus` may legitimately advance on a real bridge (KSeF is
      // async), so assert membership rather than equality — but the document is
      // still `issued`.
      expect(status.state).toBe('issued');
      expect(BridgeRegulatoryStatusValues).toContain(status.regulatoryStatus);
    });
  });
}
