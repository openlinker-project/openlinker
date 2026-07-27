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
import * as childProcess from 'node:child_process';

import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
import { BuyerProfile, InvoiceRecordNotFoundException } from '@openlinker/core/invoicing';
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

  it('#1297: round-trips the issuedLineSnapshot jsonb column (proves the migration column exists)', async () => {
    const repository = new InvoiceRecordRepository(repo);
    const buyer = new BuyerProfile(
      'ACME Sp. z o.o.',
      { scheme: 'pl-nip', value: '1234567890' },
      { line1: 'ul. X 1', line2: null, city: 'Poznań', postalCode: '60-001', countryIso2: 'PL' },
      'company',
    );
    const created = await repository.create({
      connectionId: CONNECTION_ID,
      orderId: 'ol_order_snap',
      providerType: 'ksef',
      documentType: 'invoice',
      status: 'issued',
      idempotencyKey: 'idem-snap-1',
      issuedLineSnapshot: {
        buyer,
        currency: 'PLN',
        lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 100, taxRate: '23' }],
      },
    });

    const found = await repository.findById(created.id);
    expect(found?.issuedLineSnapshot).toEqual({
      buyer: {
        name: 'ACME Sp. z o.o.',
        taxId: { scheme: 'pl-nip', value: '1234567890' },
        address: { line1: 'ul. X 1', line2: null, city: 'Poznań', postalCode: '60-001', countryIso2: 'PL' },
        type: 'company',
        email: null,
      },
      currency: 'PLN',
      lines: [{ name: 'Widget', quantity: 2, unitPriceGross: 100, taxRate: '23' }],
    });
  });

  it('defaults issuedLineSnapshot to null when not supplied', async () => {
    const saved = await repo.save(row({ orderId: 'ol_order_snap_null' }));
    const found = await repo.findOneOrFail({ where: { id: saved.id } });
    expect(found.issuedLineSnapshot).toBeNull();
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

    // Regression tests for the timestamptz fix (#1296). Root cause: node-postgres
    // serializes an outgoing `Date` parameter using the PROCESS's LOCAL time
    // components + local UTC offset (`pg/lib/utils.js` `dateToString`), and a
    // `timestamp without time zone` column silently DROPS that offset on write
    // (Postgres ignores any zone indication for a naive-timestamp input) — so the
    // stored digits are the writing process's LOCAL wall-clock rendering of the
    // instant, not its UTC rendering. The same happens on the comparing side: the
    // bound `:now` parameter is also serialized using ITS OWN process's local
    // wall-clock digits, offset dropped. Two processes with the SAME local
    // timezone round-trip correctly by symmetry (which is why flipping
    // Postgres's session `TimeZone` GUC — or `process.env.TZ` on an
    // already-running process, which several Node/V8 builds don't honour for
    // already-initialized Date state — has NO effect); the skew appears only
    // when the WRITING process and the COMPARING process have genuinely
    // different OS-level local timezones, e.g. a lease written by one
    // worker/host and evaluated by another with a different `TZ` — exactly the
    // two-worker double-claim scenario `claimForIssue` exists to prevent. A
    // real process-timezone difference requires separate OS processes (`TZ` is
    // read once at process start), so this spawns two child processes via
    // `tz-claim-probe.child.cjs` — one at `TZ=UTC` to write the lease, one at
    // `TZ=Pacific/Kiritimati` (UTC+14 — the most extreme real-world offset) to
    // run the exact CAS-claim predicate — against the SAME running
    // Testcontainers Postgres instance. `timestamptz` columns always
    // round-trip the offset explicitly, so the comparison is correct
    // regardless of either process's local timezone.
    describe('across genuinely different process-local timezones (#1296)', () => {
      const dsOptions = () => {
        const opts = harness.getDataSource().options as unknown as {
          host: string;
          port: number;
          username: string;
          password: string;
          database: string;
        };
        return opts;
      };

      function runChild(
        mode: 'write' | 'compare',
        tz: string,
        id: string,
        leaseIso: string,
        nowIso: string,
      ): { claimed?: boolean } {
        const opts = dsOptions();
        const scriptPath = require.resolve('../helpers/tz-claim-probe.child.cjs');
        const result = childProcess.spawnSync(
          process.execPath,
          [scriptPath, mode, id, leaseIso, nowIso],
          {
            // Connection details travel via PG* env vars, never argv, so the
            // test-container password never appears in `ps` output.
            env: {
              ...process.env,
              TZ: tz,
              PGHOST: String(opts.host),
              PGPORT: String(opts.port),
              PGUSER: String(opts.username),
              PGPASSWORD: String(opts.password),
              PGDATABASE: String(opts.database),
            },
            encoding: 'utf-8',
          },
        );
        if (result.status !== 0) {
          throw new Error(`tz-claim-probe.child.cjs (${mode}, TZ=${tz}) failed: ${result.stderr}`);
        }
        return JSON.parse(result.stdout) as { claimed?: boolean };
      }

      it('does NOT reclaim a live lease written by a UTC process when compared by a UTC+14 process', async () => {
        const saved = await repo.save(claimRow({ status: 'issuing', leaseExpiresAt: null }));
        const liveLeaseIso = new Date(Date.now() + 60_000).toISOString();

        runChild('write', 'UTC', saved.id, liveLeaseIso, liveLeaseIso);
        const { claimed } = runChild(
          'compare',
          'Pacific/Kiritimati',
          saved.id,
          new Date(Date.now() + 120_000).toISOString(),
          new Date().toISOString(),
        );

        expect(claimed).toBe(false);
        const reread = await repo.findOneOrFail({ where: { id: saved.id } });
        expect(reread.status).toBe('issuing');
      });

      it('reclaims an expired lease written by a UTC process when compared by a UTC+14 process', async () => {
        const saved = await repo.save(claimRow({ status: 'issuing', leaseExpiresAt: null }));
        const expiredLeaseIso = new Date(Date.now() - 60_000).toISOString();

        runChild('write', 'UTC', saved.id, expiredLeaseIso, expiredLeaseIso);
        const { claimed } = runChild(
          'compare',
          'Pacific/Kiritimati',
          saved.id,
          new Date(Date.now() + 120_000).toISOString(),
          new Date().toISOString(),
        );

        expect(claimed).toBe(true);
        const reread = await repo.findOneOrFail({ where: { id: saved.id } });
        expect(reread.status).toBe('issuing');
      });
    });
  });

  describe('findLatestByOrderIds — batch latest-per-order (#1713)', () => {
    it('returns at most one (latest) record per order and omits orders with none', async () => {
      const repository = new InvoiceRecordRepository(repo);
      await repo.save(claimRow({ orderId: 'ol_o1', status: 'issued' }));
      await repo.save(claimRow({ orderId: 'ol_o2', status: 'failed' }));
      // Two records for the same order with EXPLICIT distinct createdAt (older
      // then newer) → DISTINCT ON must keep the NEWEST, proving latest-per-order.
      await repo.save(
        claimRow({
          orderId: 'ol_o3',
          status: 'pending',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );
      await repo.save(
        claimRow({
          orderId: 'ol_o3',
          status: 'issued',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
      );

      const results = await repository.findLatestByOrderIds([
        'ol_o1',
        'ol_o2',
        'ol_o3',
        'ol_missing',
      ]);

      const byOrder = new Map(results.map((r) => [r.orderId, r]));
      expect(byOrder.size).toBe(3);
      expect(byOrder.has('ol_missing')).toBe(false);
      expect(byOrder.get('ol_o1')?.status).toBe('issued');
      expect(byOrder.get('ol_o2')?.status).toBe('failed');
      // The newer ol_o3 row wins — latest-per-order.
      expect(byOrder.get('ol_o3')?.status).toBe('issued');
    });

    it('returns [] for an empty input', async () => {
      const repository = new InvoiceRecordRepository(repo);
      expect(await repository.findLatestByOrderIds([])).toEqual([]);
    });
  });
});
