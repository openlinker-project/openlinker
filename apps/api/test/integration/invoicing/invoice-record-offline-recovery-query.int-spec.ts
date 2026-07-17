/**
 * Invoice Records offline / crash-recovery query Integration Test (#1585)
 *
 * Proves, against a real Postgres (behaviour a mocked repo cannot verify), the
 * hand-written keyset SQL the offline-resubmit (#1702) and crash-recovery (#1703)
 * sweeps rely on, plus the #1585-review hardening:
 *  - `findIssuedNonTerminal` EXCLUDES `pending-submission` rows (#1585 I5) so the
 *    reconcile poller never throws on offline records;
 *  - `findPendingSubmission` selects only `pending-submission`, is connection-
 *    scoped, honours the settling-margin `olderThan` bound (#1585 B1), and keyset-
 *    pages forward by `(updatedAt, id)`;
 *  - `claimPendingSubmission` is an atomic CAS: it wins once, a second concurrent
 *    claim under a live lease loses (`null`), an expired lease is re-claimable, and
 *    a row no longer `pending-submission` cannot be claimed;
 *  - `findStuckPending` selects the never-claimed `pending` arm and the lapsed-lease
 *    `issuing` arm (excluding a null-lease `issuing` row), both gated by `olderThan`.
 *
 * @module apps/api/test/integration/invoicing
 */
import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
import { InvoiceRecordRepository } from '@openlinker/core/invoicing/infrastructure/persistence/repositories/invoice-record.repository';
import type { RegulatoryStatus } from '@openlinker/core/invoicing';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

const CONNECTION_ID = '00000000-0000-0000-0000-000000001585';
const OTHER_CONNECTION_ID = '00000000-0000-0000-0000-000000001586';

let orderSeq = 0;

function row(overrides: Partial<InvoiceRecordOrmEntity> = {}): InvoiceRecordOrmEntity {
  orderSeq += 1;
  const entity = new InvoiceRecordOrmEntity();
  Object.assign(
    entity,
    {
      connectionId: CONNECTION_ID,
      orderId: `ol_order_${orderSeq}`,
      providerType: 'ksef',
      documentType: 'invoice',
      status: 'issued',
      idempotencyKey: null,
      regulatoryStatus: 'pending-submission' as RegulatoryStatus,
      clearanceReference: null,
    },
    overrides,
  );
  return entity;
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 60 * 1000);

describe('invoice_records offline / crash-recovery queries (integration)', () => {
  let harness: IntegrationTestHarness;
  let ormRepo: Repository<InvoiceRecordOrmEntity>;
  let repo: InvoiceRecordRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    ormRepo = harness.getDataSource().getRepository(InvoiceRecordOrmEntity);
    repo = new InvoiceRecordRepository(ormRepo);
    orderSeq = 0;
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('findIssuedNonTerminal excludes pending-submission (#1585 I5)', () => {
    it('leaves offline rows to the resubmit sweep, never the reconcile poller', async () => {
      await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
      await ormRepo.save(row({ regulatoryStatus: 'pending-submission' }));

      const { items, total } = await repo.findIssuedNonTerminal(CONNECTION_ID, { limit: 100 });

      expect(total).toBe(1);
      expect(items.map((r) => r.regulatoryStatus)).toEqual(['submitted']);
    });
  });

  describe('findPendingSubmission', () => {
    it('selects only pending-submission rows, connection-scoped', async () => {
      await ormRepo.save(row({ regulatoryStatus: 'pending-submission' }));
      await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
      await ormRepo.save(row({ connectionId: OTHER_CONNECTION_ID, regulatoryStatus: 'pending-submission' }));

      const { items, total } = await repo.findPendingSubmission(CONNECTION_ID, { limit: 100 });

      expect(total).toBe(1);
      expect(items[0].regulatoryStatus).toBe('pending-submission');
      expect(items[0].connectionId).toBe(CONNECTION_ID);
    });

    it('honours the settling-margin olderThan bound (#1585 B1)', async () => {
      await ormRepo.save(row({ regulatoryStatus: 'pending-submission' }));

      // A just-touched row is EXCLUDED under a past olderThan (still settling)...
      const settling = await repo.findPendingSubmission(CONNECTION_ID, { limit: 100, olderThan: PAST });
      expect(settling.items).toHaveLength(0);

      // ...and INCLUDED once the margin has elapsed (olderThan in the future).
      const eligible = await repo.findPendingSubmission(CONNECTION_ID, { limit: 100, olderThan: FUTURE });
      expect(eligible.items).toHaveLength(1);
    });

    it('keyset-pages forward by (updatedAt, id) without an updatedAt bump', async () => {
      for (let i = 0; i < 3; i += 1) {
        await ormRepo.save(row({ regulatoryStatus: 'pending-submission' }));
      }

      const seen: string[] = [];
      let cursor: { updatedAt: Date; id: string } | undefined;
      for (let page = 0; page < 5; page += 1) {
        const { items } = await repo.findPendingSubmission(CONNECTION_ID, { limit: 1, cursor });
        if (items.length === 0) break;
        const last = items[items.length - 1];
        seen.push(last.id);
        cursor = { updatedAt: last.updatedAt, id: last.id };
      }

      expect(new Set(seen).size).toBe(3);
    });
  });

  describe('claimPendingSubmission (atomic CAS, #1585 B1)', () => {
    it('wins the first claim and loses a concurrent claim under a live lease', async () => {
      const saved = await ormRepo.save(row({ regulatoryStatus: 'pending-submission' }));

      const first = await repo.claimPendingSubmission(saved.id, FUTURE);
      expect(first).not.toBeNull();

      // A second overlapping run finds the lease live -> null (must not resubmit).
      const second = await repo.claimPendingSubmission(saved.id, FUTURE);
      expect(second).toBeNull();

      const reread = await ormRepo.findOneOrFail({ where: { id: saved.id } });
      expect(reread.leaseExpiresAt).not.toBeNull();
    });

    it('re-claims a record whose prior lease has expired', async () => {
      const saved = await ormRepo.save(
        row({ regulatoryStatus: 'pending-submission', leaseExpiresAt: PAST }),
      );

      const claimed = await repo.claimPendingSubmission(saved.id, FUTURE);
      expect(claimed).not.toBeNull();
    });

    it('cannot claim a row that is no longer pending-submission', async () => {
      const saved = await ormRepo.save(row({ regulatoryStatus: 'submitted' }));

      const claimed = await repo.claimPendingSubmission(saved.id, FUTURE);
      expect(claimed).toBeNull();
    });
  });

  describe('findStuckPending', () => {
    it('selects the never-claimed pending arm and the lapsed-lease issuing arm, excluding a null-lease issuing row', async () => {
      const pending = await ormRepo.save(row({ status: 'pending', regulatoryStatus: 'not-applicable' }));
      const issuingLapsed = await ormRepo.save(
        row({ status: 'issuing', regulatoryStatus: 'not-applicable', leaseExpiresAt: PAST }),
      );
      // Excluded: an issuing row with a NULL lease cannot be a lapsed claim.
      await ormRepo.save(row({ status: 'issuing', regulatoryStatus: 'not-applicable', leaseExpiresAt: null }));
      // Excluded: a terminal issued row.
      await ormRepo.save(row({ status: 'issued', regulatoryStatus: 'submitted' }));

      const { items, total } = await repo.findStuckPending(CONNECTION_ID, {
        olderThan: FUTURE,
        limit: 100,
      });

      expect(total).toBe(2);
      expect(new Set(items.map((r) => r.id))).toEqual(new Set([pending.id, issuingLapsed.id]));
    });

    it('excludes rows newer than the safety-margin olderThan bound', async () => {
      await ormRepo.save(row({ status: 'pending', regulatoryStatus: 'not-applicable' }));
      await ormRepo.save(
        row({ status: 'issuing', regulatoryStatus: 'not-applicable', leaseExpiresAt: new Date() }),
      );

      // A past olderThan means neither the just-touched pending row nor the
      // just-set lease qualifies yet (still within the safety margin).
      const { items, total } = await repo.findStuckPending(CONNECTION_ID, {
        olderThan: PAST,
        limit: 100,
      });

      expect(total).toBe(0);
      expect(items).toHaveLength(0);
    });
  });
});
