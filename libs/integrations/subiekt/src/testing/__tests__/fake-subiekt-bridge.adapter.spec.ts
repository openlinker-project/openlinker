/**
 * FakeSubiektBridgeAdapter — unit tests
 *
 * Runs the shared contract suite against the fake, then asserts the
 * fake-specific helpers (deterministic numbering, seeded failure modes,
 * `seed`/`clear`).
 *
 * @module libs/integrations/subiekt/testing
 */
import {
  SubiektBridgeUnreachableError,
  SubiektRejectedError,
} from '../../bridge/subiekt-bridge.errors';
import { FakeSubiektBridgeAdapter } from '../fake-subiekt-bridge.adapter';
import {
  runSubiektBridgeContractTests,
  sampleBridgeBuyer,
  sampleIssueInvoiceRequest,
} from '../subiekt-bridge-contract.suite';

describe('FakeSubiektBridgeAdapter', () => {
  // The behavioural contract every SubiektBridgeClient must satisfy.
  runSubiektBridgeContractTests(() => new FakeSubiektBridgeAdapter());

  describe('fake-specific behaviour', () => {
    let fake: FakeSubiektBridgeAdapter;

    beforeEach(() => {
      fake = new FakeSubiektBridgeAdapter();
    });

    it('should number successive invoices deterministically', async () => {
      const a = await fake.issueInvoice(sampleIssueInvoiceRequest());
      const b = await fake.issueInvoice(sampleIssueInvoiceRequest());
      expect(a.providerInvoiceNumber).toBe('FV-MOCK-001');
      expect(b.providerInvoiceNumber).toBe('FV-MOCK-002');
    });

    it('should reject with SubiektBridgeUnreachableError when that failure is seeded', async () => {
      fake.seedFailure('bridge-unreachable');
      await expect(fake.issueInvoice(sampleIssueInvoiceRequest())).rejects.toBeInstanceOf(
        SubiektBridgeUnreachableError,
      );
    });

    it('should reject with SubiektRejectedError carrying the reason when seeded', async () => {
      fake.seedFailure('subiekt-rejected', { reason: 'invalid NIP' });
      await expect(fake.upsertCustomer({ buyer: sampleBridgeBuyer() })).rejects.toThrow(
        'invalid NIP',
      );
      await expect(fake.upsertCustomer({ buyer: sampleBridgeBuyer() })).rejects.toBeInstanceOf(
        SubiektRejectedError,
      );
    });

    it('should override response fields when seed() is used (e.g. an accepted regulatory status)', async () => {
      fake.seed({ regulatoryStatus: 'accepted' });
      const res = await fake.issueInvoice(sampleIssueInvoiceRequest());
      expect(res.regulatoryStatus).toBe('accepted');
    });

    it('should return a failed status for an unknown provider invoice id', async () => {
      const status = await fake.getInvoiceStatus({ providerInvoiceId: 'does-not-exist' });
      expect(status.state).toBe('failed');
      expect(status.regulatoryStatus).toBe('none');
    });

    it('should reset counters and seeded failure on clear()', async () => {
      fake.seedFailure('bridge-unreachable');
      fake.seed({ regulatoryStatus: 'accepted' });
      await fake.issueInvoice(sampleIssueInvoiceRequest()).catch(() => undefined);
      fake.clear();
      const res = await fake.issueInvoice(sampleIssueInvoiceRequest());
      expect(res.providerInvoiceNumber).toBe('FV-MOCK-001');
      expect(res.regulatoryStatus).toBe('sent');
    });
  });
});
