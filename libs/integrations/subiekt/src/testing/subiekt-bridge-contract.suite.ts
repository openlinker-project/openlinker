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
  BridgeIssueCorrectionRequest,
  BridgeIssueInvoiceRequest,
  BridgeUpsertCustomerRequest,
} from '../bridge/subiekt-bridge.types';

/**
 * A representative bridge buyer for contract / adapter tests — shaped EXACTLY
 * like the real bridge inline `BuyerDto` (Polish address fields, `nip`,
 * `isCompany`).
 */
export function sampleBridgeBuyer(overrides: Partial<BridgeBuyer> = {}): BridgeBuyer {
  return {
    name: 'Przykład Sp. z o.o.',
    nip: '1234567890',
    isCompany: true,
    address: {
      ulica: 'Przykładowa 1',
      nrLokalu: null,
      kodPocztowy: '00-001',
      miejscowosc: 'Warszawa',
      countryCode: 'PL',
    },
    ...overrides,
  };
}

/**
 * A representative TOP-LEVEL upsert-customer request — shaped EXACTLY like the
 * real bridge `CreateFirmaRequestDto` (nazwaSkrocona/nip/typ/address).
 */
export function sampleUpsertCustomerRequest(
  overrides: Partial<BridgeUpsertCustomerRequest> = {},
): BridgeUpsertCustomerRequest {
  return {
    nazwaSkrocona: 'Przykład Sp. z o.o.',
    nip: '1234567890',
    typ: 'firma',
    address: {
      ulica: 'Przykładowa 1',
      kodPocztowy: '00-001',
      miejscowosc: 'Warszawa',
      countryCode: 'PL',
    },
    ...overrides,
  };
}

/**
 * A representative issue-invoice request for contract / adapter tests — shaped
 * EXACTLY like the real bridge `CreateInvoiceRequestDto` (documentType 'FV'/'PA',
 * inline `buyer`, Polish line fields).
 */
export function sampleIssueInvoiceRequest(
  overrides: Partial<BridgeIssueInvoiceRequest> = {},
): BridgeIssueInvoiceRequest {
  return {
    documentType: 'FV',
    currency: 'PLN',
    orderId: 'ol_order_sample',
    idempotencyKey: 'idem-sample',
    buyer: sampleBridgeBuyer(),
    lines: [{ ilosc: 1, cenaBrutto: 123.0, stawkaVAT: '23', name: 'Widget' }],
    ...overrides,
  };
}

/**
 * A representative issue-CORRECTION request for contract / adapter tests — shaped
 * like the real bridge `CreateCorrectionRequestDto` (`documentType: 'FK'`, an
 * `originalProviderInvoiceId` reference, inline `buyer`, Polish line fields).
 * EXTERNAL DEPENDENCY: the live endpoint is openlinker-subiekt#6.
 */
export function sampleIssueCorrectionRequest(
  overrides: Partial<BridgeIssueCorrectionRequest> = {},
): BridgeIssueCorrectionRequest {
  return {
    documentType: 'FK',
    currency: 'PLN',
    orderId: 'ol_order_sample',
    idempotencyKey: 'idem-correction-sample',
    originalProviderInvoiceId: '100001',
    reason: 'Zwrot towaru',
    buyer: sampleBridgeBuyer(),
    lines: [{ ilosc: 1, cenaBrutto: 123.0, stawkaVAT: '23', name: 'Widget' }],
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
      expect(typeof res.providerInvoiceId).toBe('number');
      expect(res.providerInvoiceNumber).toBeTruthy();
      expect(res.state).toBe('issued');
      expect(BridgeRegulatoryStatusValues).toContain(res.regulatoryStatus);
    });

    it('should issue a correction document with a provider id, number and a known regulatory status', async () => {
      const res = await client.issueCorrection(sampleIssueCorrectionRequest());
      expect(res.providerInvoiceId).toBeTruthy();
      expect(typeof res.providerInvoiceId).toBe('number');
      expect(res.providerInvoiceNumber).toBeTruthy();
      expect(res.state).toBe('issued');
      expect(BridgeRegulatoryStatusValues).toContain(res.regulatoryStatus);
    });

    it('should read back the state of a just-issued correction document', async () => {
      const corrected = await client.issueCorrection(sampleIssueCorrectionRequest());
      const status = await client.getInvoiceStatus({
        providerInvoiceId: String(corrected.providerInvoiceId),
      });
      expect(status.state).toBe('issued');
      expect(BridgeRegulatoryStatusValues).toContain(status.regulatoryStatus);
    });

    it('should upsert a customer and return the customer id', async () => {
      const res = await client.upsertCustomer(sampleUpsertCustomerRequest());
      expect(res.id).toBeTruthy();
      expect(typeof res.id).toBe('number');
    });

    it('should read back the state of a just-issued document', async () => {
      const issued = await client.issueInvoice(sampleIssueInvoiceRequest());
      const status = await client.getInvoiceStatus({
        providerInvoiceId: String(issued.providerInvoiceId),
      });
      // `regulatoryStatus` may legitimately advance on a real bridge (KSeF is
      // async), so assert membership rather than equality — but the document is
      // still `issued`.
      expect(status.state).toBe('issued');
      expect(BridgeRegulatoryStatusValues).toContain(status.regulatoryStatus);
    });
  });
}
