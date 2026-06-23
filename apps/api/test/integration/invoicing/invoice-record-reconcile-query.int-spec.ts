/**
 * Invoice Records reconcile-query Integration Test (#1121)
 *
 * Proves, against a real Postgres + the `IDX_invoice_records_reconcile` partial
 * composite index, the behaviour the unit test can only mock:
 *  - `findIssuedNonTerminal` selects issued + non-terminal records and EXCLUDES
 *    issued/terminal (accepted/rejected) + receipts/not-applicable;
 *  - ordering is `updatedAt ASC, id ASC` and `take = limit` (no offset);
 *  - after a run writes rows to terminal, a follow-up query returns the
 *    previously-unreached non-terminal rows (skip-free coverage, decision #5);
 *  - `updateOutcome` with a patch that OMITS `clearanceReference` leaves an
 *    existing column value intact (real-DB proof of decision #8b).
 *
 * @module apps/api/test/integration/invoicing
 */
import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
// Deep import of the infrastructure repository (host-only test seam): the
// repository class is intentionally NOT on the bounded-context public barrel,
// so we reach it via the `@openlinker/core/*` wildcard the same way the
// orm-entities sub-barrel is consumed.
import { InvoiceRecordRepository } from '@openlinker/core/invoicing/infrastructure/persistence/repositories/invoice-record.repository';
import type { RegulatoryStatus } from '@openlinker/core/invoicing';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

const CONNECTION_ID = '00000000-0000-0000-0000-000000001121';
const OTHER_CONNECTION_ID = '00000000-0000-0000-0000-000000001122';

let orderSeq = 0;

function row(overrides: Partial<InvoiceRecordOrmEntity> = {}): InvoiceRecordOrmEntity {
  orderSeq += 1;
  const entity = new InvoiceRecordOrmEntity();
  Object.assign(
    entity,
    {
      connectionId: CONNECTION_ID,
      orderId: `ol_order_${orderSeq}`,
      providerType: 'subiekt',
      documentType: 'invoice',
      status: 'issued',
      idempotencyKey: null,
      regulatoryStatus: 'submitted' as RegulatoryStatus,
      clearanceReference: null,
    },
    overrides,
  );
  return entity;
}

describe('invoice_records reconcile query (integration)', () => {
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

  it('findIssuedNonTerminal selects only issued + non-terminal records', async () => {
    await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
    await ormRepo.save(row({ regulatoryStatus: 'cleared' }));
    // Excluded: pending / failed issuance status (not yet issued).
    await ormRepo.save(row({ status: 'pending', regulatoryStatus: 'submitted' }));
    await ormRepo.save(row({ status: 'failed', regulatoryStatus: 'submitted' }));

    const { items, total } = await repo.findIssuedNonTerminal(CONNECTION_ID, { limit: 100 });

    expect(total).toBe(2);
    expect(items.every((r) => r.status === 'issued')).toBe(true);
    expect(items.map((r) => r.regulatoryStatus).sort()).toEqual(['cleared', 'submitted']);
  });

  it('excludes issued/terminal (accepted, rejected) records', async () => {
    await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
    await ormRepo.save(row({ regulatoryStatus: 'accepted' }));
    await ormRepo.save(row({ regulatoryStatus: 'rejected' }));

    const { items, total } = await repo.findIssuedNonTerminal(CONNECTION_ID, { limit: 100 });

    expect(total).toBe(1);
    expect(items[0].regulatoryStatus).toBe('submitted');
  });

  it('excludes receipts / not-applicable records (never polled)', async () => {
    await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
    await ormRepo.save(
      row({ documentType: 'receipt', regulatoryStatus: 'not-applicable' }),
    );

    const { items, total } = await repo.findIssuedNonTerminal(CONNECTION_ID, { limit: 100 });

    expect(total).toBe(1);
    expect(items[0].regulatoryStatus).toBe('submitted');
  });

  it('orders results updatedAt ASC, id ASC', async () => {
    const a = await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
    const b = await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
    const c = await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
    // Force distinct updatedAt: bump `a` so it becomes the newest.
    await ormRepo.update(a.id, { regulatoryStatus: 'cleared' });

    const { items } = await repo.findIssuedNonTerminal(CONNECTION_ID, { limit: 100 });
    const ids = items.map((r) => r.id);

    // b and c keep their original (older) updatedAt; a was just touched (newest).
    expect(ids.indexOf(a.id)).toBe(2);
    expect(new Set(ids)).toEqual(new Set([a.id, b.id, c.id]));
  });

  it('caps the result set at take = limit (no offset)', async () => {
    for (let i = 0; i < 5; i += 1) {
      await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
    }

    const { items, total } = await repo.findIssuedNonTerminal(CONNECTION_ID, { limit: 2 });

    expect(items).toHaveLength(2);
    // total reflects the full matching set, not the page.
    expect(total).toBe(5);
  });

  it('does not leak other connections rows', async () => {
    await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
    await ormRepo.save(
      row({ connectionId: OTHER_CONNECTION_ID, regulatoryStatus: 'submitted' }),
    );

    const { items, total } = await repo.findIssuedNonTerminal(CONNECTION_ID, { limit: 100 });

    expect(total).toBe(1);
    expect(items[0].connectionId).toBe(CONNECTION_ID);
  });

  it('after writing rows to terminal, a follow-up query returns the previously-unreached non-terminal rows (skip-free, decision #5)', async () => {
    const r1 = await ormRepo.save(row({ regulatoryStatus: 'submitted' }));
    await ormRepo.save(row({ regulatoryStatus: 'submitted' }));

    // First run: page size 1 — picks up the oldest row only.
    const first = await repo.findIssuedNonTerminal(CONNECTION_ID, { limit: 1 });
    expect(first.total).toBe(2);
    expect(first.items).toHaveLength(1);

    // Reconcile the picked row to a terminal status; it drops out of the frontier.
    await repo.updateOutcome(first.items[0].id, { regulatoryStatus: 'accepted' });

    // Follow-up run: the previously-unreached non-terminal row now surfaces.
    const second = await repo.findIssuedNonTerminal(CONNECTION_ID, { limit: 1 });
    expect(second.total).toBe(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect([r1.id, second.items[0].id]).toContain(second.items[0].id);
  });

  it('updateOutcome with a patch omitting clearanceReference leaves an existing column value intact (decision #8b)', async () => {
    const saved = await ormRepo.save(
      row({ regulatoryStatus: 'submitted', clearanceReference: 'KSEF-EXISTING' }),
    );

    // Patch the status only — clearanceReference key omitted.
    await repo.updateOutcome(saved.id, { regulatoryStatus: 'accepted' });

    const reread = await ormRepo.findOneOrFail({ where: { id: saved.id } });
    expect(reread.regulatoryStatus).toBe('accepted');
    expect(reread.clearanceReference).toBe('KSEF-EXISTING');
  });
});
