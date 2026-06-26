/**
 * Invoice Records persistence Integration Test (#751, #1200)
 *
 * Proves the `CreateInvoiceRecords1808000000000` migration + real Postgres
 * behaviour for the invoicing foundation (ADR-026): the table + columns exist,
 * and the partial-unique fiscal-dedup index (`(connectionId, idempotencyKey)
 * WHERE idempotencyKey IS NOT NULL`) actually rejects a duplicate while still
 * allowing many NULL-key rows.
 *
 * It ALSO exercises the `claimForIssue` raw CAS `UPDATE ... WHERE (...) RETURNING *`
 * (#1200) against real Postgres — the atomic single-flight guard that underwrites
 * *"a real fiscal document must never be double-issued"*. The unit test can only
 * run this against a fully-mocked QueryBuilder; here we prove, on real Postgres:
 *  - exactly ONE of two parallel `claimForIssue` calls wins (the other backs off);
 *  - the `status = 'failed' AND failureMode = 'rejected'` claimable predicate;
 *  - an in-doubt `failed` / live `issuing` / terminal `issued` row is NOT claimable;
 *  - the expired-lease (`leaseExpiresAt <= now`) re-claim branch;
 *  - `create(raw)` hydration of the RETURNING row into a fully-typed domain record;
 *  - a not-found id throws `InvoiceRecordNotFoundException`.
 *
 * @module apps/api/test/integration/invoicing
 */
import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
import { InvoiceRecordNotFoundException } from '@openlinker/core/invoicing';
// Deep import of the infrastructure repository (host-only test seam): the
// repository class is intentionally NOT on the bounded-context public barrel,
// so we reach it via the `@openlinker/core/*` wildcard the same way the
// orm-entities sub-barrel is consumed.
import { InvoiceRecordRepository } from '@openlinker/core/invoicing/infrastructure/persistence/repositories/invoice-record.repository';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

const CONNECTION_ID = '00000000-0000-0000-0000-000000000751';

let claimSeq = 0;

function row(overrides: Partial<InvoiceRecordOrmEntity> = {}): InvoiceRecordOrmEntity {
  const entity = new InvoiceRecordOrmEntity();
  Object.assign(
    entity,
    {
      connectionId: CONNECTION_ID,
      orderId: 'ol_order_int1',
      providerType: 'subiekt',
      documentType: 'invoice',
      status: 'pending',
      idempotencyKey: 'idem-int-1',
    },
    overrides,
  );
  return entity;
}

// A claim-test row needs a DISTINCT (connectionId, idempotencyKey) per save to
// avoid colliding on the partial-unique dedup index — use a null key + unique
// orderId so the fixtures stay independent of the dedup index entirely.
function claimRow(overrides: Partial<InvoiceRecordOrmEntity> = {}): InvoiceRecordOrmEntity {
  claimSeq += 1;
  return row({
    idempotencyKey: null,
    orderId: `ol_order_claim_${claimSeq}`,
    ...overrides,
  });
}

describe('invoice_records persistence (integration)', () => {
  let harness: IntegrationTestHarness;
  let repo: Repository<InvoiceRecordOrmEntity>;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    repo = harness.getDataSource().getRepository(InvoiceRecordOrmEntity);
    claimSeq = 0;
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('persists a row with neutral defaults and reads it back', async () => {
    const saved = await repo.save(row());
    expect(saved.id).toBeDefined();

    const found = await repo.findOne({
      where: { orderId: 'ol_order_int1', connectionId: CONNECTION_ID },
    });
    expect(found?.providerType).toBe('subiekt');
    expect(found?.documentType).toBe('invoice');
    // Migration default applied without the app setting it explicitly.
    expect(found?.regulatoryStatus).toBe('not-applicable');
    expect(found?.clearanceReference).toBeNull();
  });

  it('rejects a duplicate (connectionId, idempotencyKey) at the DB index', async () => {
    await repo.save(row());
    await expect(repo.save(row({ orderId: 'ol_order_int_dup' }))).rejects.toThrow();
  });

  it('allows multiple rows with a null idempotencyKey (partial index)', async () => {
    const a = await repo.save(row({ idempotencyKey: null, orderId: 'ol_order_a' }));
    const b = await repo.save(row({ idempotencyKey: null, orderId: 'ol_order_b' }));
    expect(a.id).not.toBe(b.id);
  });

  describe('claimForIssue — atomic single-flight CAS (#1200)', () => {
    let repository: InvoiceRecordRepository;

    beforeEach(() => {
      repository = new InvoiceRecordRepository(repo);
    });

    it('lets exactly ONE of two parallel claims on the same pending row win', async () => {
      const saved = await repo.save(claimRow({ status: 'pending' }));
      const lease = new Date(Date.now() + 5 * 60 * 1000);

      // Fire both claims concurrently — the row-level lock on the CAS UPDATE
      // serialises them; the loser re-evaluates its WHERE against the now-`issuing`
      // row and matches nothing (affected 0 → null).
      const [a, b] = await Promise.all([
        repository.claimForIssue(saved.id, lease),
        repository.claimForIssue(saved.id, lease),
      ]);

      const winners = [a, b].filter((r) => r !== null);
      expect(winners).toHaveLength(1);
      // The winner is hydrated from RETURNING * into a fully-typed domain record.
      const winner = winners[0]!;
      expect(winner.id).toBe(saved.id);
      expect(winner.status).toBe('issuing');
      expect(winner.leaseExpiresAt).not.toBeNull();
      expect(winner.orderId).toBe(saved.orderId);
      expect(winner.providerType).toBe('subiekt');

      // The DB row is `issuing` exactly once — no double claim landed.
      const reread = await repo.findOneOrFail({ where: { id: saved.id } });
      expect(reread.status).toBe('issuing');
    });

    it('claims a terminal-rejected failed row (no document exists — safe to re-issue)', async () => {
      const saved = await repo.save(
        claimRow({ status: 'failed', failureMode: 'rejected' }),
      );

      const claimed = await repository.claimForIssue(
        saved.id,
        new Date(Date.now() + 60_000),
      );

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('issuing');
    });

    it('does NOT claim an in-doubt failed row (a document may already exist)', async () => {
      const saved = await repo.save(
        claimRow({ status: 'failed', failureMode: 'in-doubt' }),
      );

      const claimed = await repository.claimForIssue(
        saved.id,
        new Date(Date.now() + 60_000),
      );

      expect(claimed).toBeNull();
      const reread = await repo.findOneOrFail({ where: { id: saved.id } });
      expect(reread.status).toBe('failed');
    });

    it('does NOT claim a terminal issued row', async () => {
      const saved = await repo.save(claimRow({ status: 'issued' }));

      const claimed = await repository.claimForIssue(
        saved.id,
        new Date(Date.now() + 60_000),
      );

      expect(claimed).toBeNull();
    });

    it('does NOT claim an issuing row whose lease is still live', async () => {
      const saved = await repo.save(
        claimRow({ status: 'issuing', leaseExpiresAt: new Date(Date.now() + 60_000) }),
      );

      const claimed = await repository.claimForIssue(
        saved.id,
        new Date(Date.now() + 60_000),
      );

      expect(claimed).toBeNull();
    });

    it('re-claims an issuing row whose lease has expired (crashed prior attempt)', async () => {
      const saved = await repo.save(
        claimRow({ status: 'issuing', leaseExpiresAt: new Date(Date.now() - 60_000) }),
      );

      const newLease = new Date(Date.now() + 60_000);
      const claimed = await repository.claimForIssue(saved.id, newLease);

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('issuing');
      expect(claimed!.leaseExpiresAt).not.toBeNull();
      // The lease was advanced to the new attempt's window.
      expect(claimed!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('throws InvoiceRecordNotFoundException for an absent id', async () => {
      await expect(
        repository.claimForIssue(
          '00000000-0000-0000-0000-0000000009ff',
          new Date(Date.now() + 60_000),
        ),
      ).rejects.toBeInstanceOf(InvoiceRecordNotFoundException);
    });
  });
});
