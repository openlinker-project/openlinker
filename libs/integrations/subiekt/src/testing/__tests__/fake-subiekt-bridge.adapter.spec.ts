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
  sampleIssueInvoiceRequest,
  sampleKorektaRequest,
  sampleUpsertCustomerRequest,
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
      await expect(fake.upsertCustomer(sampleUpsertCustomerRequest())).rejects.toThrow(
        'invalid NIP',
      );
      await expect(fake.upsertCustomer(sampleUpsertCustomerRequest())).rejects.toBeInstanceOf(
        SubiektRejectedError,
      );
    });

    it('should override response fields when seed() is used (e.g. an accepted regulatory status)', async () => {
      fake.seed({ regulatoryStatus: 'accepted' });
      const res = await fake.issueInvoice(sampleIssueInvoiceRequest());
      expect(res.regulatoryStatus).toBe('accepted');
    });

    it('should capture the korekta request body, including idempotencyKey (#1229)', async () => {
      expect(fake.getLastKorektaRequest()).toBeNull();
      await fake.issueCorrection(100001, sampleKorektaRequest({ idempotencyKey: 'idem-kor' }));
      expect(fake.getLastKorektaRequest()?.idempotencyKey).toBe('idem-kor');
      fake.clear();
      expect(fake.getLastKorektaRequest()).toBeNull();
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

    describe('discovery methods (#1324)', () => {
      it('should list >=2 bank accounts, exactly one default, and a distinct ownerPodmiotId', async () => {
        const res = await fake.listBankAccounts();
        expect(res.count).toBe(res.accounts.length);
        expect(res.accounts.length).toBeGreaterThanOrEqual(2);
        expect(res.accounts.filter((a) => a.isDefault)).toHaveLength(1);
        const owners = new Set(res.accounts.map((a) => a.ownerPodmiotId));
        expect(owners.size).toBeGreaterThanOrEqual(2);
      });

      it('should flip the default when setDefaultBankAccount targets a seeded id', async () => {
        const before = await fake.listBankAccounts();
        const nonDefault = before.accounts.find((a) => !a.isDefault);
        expect(nonDefault).toBeDefined();
        const res = await fake.setDefaultBankAccount(nonDefault!.id);
        expect(res).toEqual({ bankAccountId: nonDefault!.id, isDefault: true });
        const after = await fake.listBankAccounts();
        expect(after.accounts.filter((a) => a.isDefault)).toHaveLength(1);
        expect(after.accounts.find((a) => a.isDefault)?.id).toBe(nonDefault!.id);
      });

      it('should reject setDefaultBankAccount with SubiektRejectedError for an unknown id', async () => {
        await expect(fake.setDefaultBankAccount(999_999)).rejects.toBeInstanceOf(
          SubiektRejectedError,
        );
      });

      it('should list cash registers with a mix of linked and unlinked (oddzialId: null)', async () => {
        const res = await fake.listCashRegisters();
        expect(res.count).toBe(res.cashRegisters.length);
        expect(res.cashRegisters.some((c) => c.oddzialId === null)).toBe(true);
        expect(res.cashRegisters.some((c) => c.oddzialId !== null)).toBe(true);
      });

      it('should reject discovery calls when a bridge-unreachable failure is seeded', async () => {
        fake.seedFailure('bridge-unreachable');
        await expect(fake.listBankAccounts()).rejects.toBeInstanceOf(SubiektBridgeUnreachableError);
        await expect(fake.listCashRegisters()).rejects.toBeInstanceOf(
          SubiektBridgeUnreachableError,
        );
      });

      it('should honour seeded discovery data and reset it on clear()', async () => {
        fake.seedBankAccounts([
          {
            id: 5,
            name: 'Solo',
            number: null,
            bankNumber: null,
            description: null,
            currency: 'PLN',
            isVatAccount: false,
            isDefault: true,
            ownerPodmiotId: 1,
            ownerName: null,
          },
        ]);
        fake.seedCashRegisters([{ id: 9, name: 'Only register', symbol: null, oddzialId: 9 }]);
        expect((await fake.listBankAccounts()).count).toBe(1);
        expect((await fake.listCashRegisters()).count).toBe(1);
        fake.clear();
        expect((await fake.listBankAccounts()).accounts.length).toBeGreaterThanOrEqual(2);
        expect((await fake.listCashRegisters()).cashRegisters.length).toBeGreaterThanOrEqual(2);
      });
    });
  });
});
