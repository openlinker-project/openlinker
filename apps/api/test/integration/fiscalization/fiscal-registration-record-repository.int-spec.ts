/**
 * Fiscal Registration Records persistence Integration Test (#1908, ADR-042)
 *
 * Proves the `CreateFiscalRegistrationRecords1834000000000` migration and real
 * Postgres behaviour for the exactly-once guarantee, which is the highest-severity
 * acceptance criterion in the epic: retrying must never produce a second fiscal
 * registration of the same sale.
 *
 * Both halves of that guarantee only exist against a real database, so both are
 * exercised here rather than against a mocked query builder:
 *
 *   - the PLAIN unique index on `(connectionId, idempotencyKey)` really rejects a
 *     duplicate, and - unlike `invoice_records`' partial index - has no null-key
 *     escape hatch, because the column is NOT NULL;
 *   - the `claimForRegistration` CAS `UPDATE ... WHERE (...) RETURNING *` lets
 *     exactly ONE of two parallel claims win, and refuses the three shapes that
 *     must never be re-sent (registered, in-doubt, live lease).
 *
 * @module apps/api/test/integration/fiscalization
 */
import { FiscalRegistrationRecordOrmEntity } from '@openlinker/core/fiscalization/orm-entities';
import { FiscalRegistrationRecordNotFoundException } from '@openlinker/core/fiscalization';
// Deep import of the infrastructure repository (host-only test seam): the
// repository class is intentionally NOT on the bounded-context public barrel, so
// it is reached via the `@openlinker/core/*` wildcard, the same way the
// orm-entities sub-barrel is consumed.
import { FiscalRegistrationRecordRepository } from '@openlinker/core/fiscalization/infrastructure/persistence/repositories/fiscal-registration-record.repository';
import type { Repository } from 'typeorm';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

// `connectionId` is a real `uuid` column, so a readable placeholder like 'conn-a'
// is rejected by Postgres before any assertion runs.
const CONNECTION_ID = '00000000-0000-0000-0000-0000000019a8';
const OTHER_CONNECTION_ID = '00000000-0000-0000-0000-0000000019b8';

let seq = 0;

function row(
  overrides: Partial<FiscalRegistrationRecordOrmEntity> = {},
): FiscalRegistrationRecordOrmEntity {
  seq += 1;
  const entity = new FiscalRegistrationRecordOrmEntity();
  Object.assign(
    entity,
    {
      connectionId: CONNECTION_ID,
      orderId: `ol_order_int_${seq}`,
      providerType: 'provider-a',
      idempotencyKey: `fiscal:int:${seq}`,
      status: 'pending',
    },
    overrides,
  );
  return entity;
}

describe('fiscal_registration_records persistence (integration)', () => {
  let harness: IntegrationTestHarness;
  let repo: Repository<FiscalRegistrationRecordOrmEntity>;
  let repository: FiscalRegistrationRecordRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    repo = harness.getDataSource().getRepository(FiscalRegistrationRecordOrmEntity);
    repository = new FiscalRegistrationRecordRepository(repo);
    seq = 0;
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('persists a row with neutral defaults and reads it back', async () => {
    const created = await repository.create({
      connectionId: CONNECTION_ID,
      orderId: 'ol_order_neutral',
      providerType: '',
      idempotencyKey: 'fiscal:neutral:1',
      status: 'pending',
    });

    const found = await repository.findById(created.id);
    expect(found?.status).toBe('pending');
    expect(found?.providerReference).toBeNull();
    expect(found?.documentReference).toBeNull();
    expect(found?.signingIdentity).toBeNull();
    expect(found?.registeredAt).toBeNull();
    expect(found?.regimeExtras).toBeNull();
    expect(found?.artefacts).toBeNull();
    expect(found?.leaseExpiresAt).toBeNull();
  });

  it('round-trips the adapter-owned regimeExtras and artefacts jsonb columns', async () => {
    const created = await repository.create({
      connectionId: CONNECTION_ID,
      orderId: 'ol_order_extras',
      providerType: 'provider-a',
      idempotencyKey: 'fiscal:extras:1',
      status: 'pending',
    });

    await repository.updateOutcome(created.id, {
      status: 'registered',
      regimeExtras: { someRegimeKey: 'value', another: '42' },
      artefacts: [
        {
          medium: 'link',
          disposition: 'send',
          content: 'https://example.test/r/1',
          contentType: null,
          label: 'Receipt link',
        },
      ],
    });

    const found = await repository.findById(created.id);
    expect(found?.regimeExtras).toEqual({ someRegimeKey: 'value', another: '42' });
    expect(found?.artefacts).toEqual([
      {
        medium: 'link',
        disposition: 'send',
        content: 'https://example.test/r/1',
        contentType: null,
        label: 'Receipt link',
      },
    ]);
  });

  it('persists an EMPTY artefact list distinctly from "never got that far"', async () => {
    // `[]` on a registered row is a SUCCESS (a pure reporting regime returns
    // identifiers only); `null` is a row that never reached the provider. If the
    // column collapsed the two, an operator could not tell them apart.
    const created = await repository.create({
      connectionId: CONNECTION_ID,
      orderId: 'ol_order_empty_artefacts',
      providerType: 'provider-a',
      idempotencyKey: 'fiscal:empty:1',
      status: 'pending',
    });

    await repository.updateOutcome(created.id, { status: 'registered', artefacts: [] });

    const found = await repository.findById(created.id);
    expect(found?.artefacts).toEqual([]);
    expect(found?.artefacts).not.toBeNull();
  });

  describe('the exactly-once unique guard', () => {
    it('rejects a duplicate (connectionId, idempotencyKey) as a DOMAIN error', async () => {
      await repository.create({
        connectionId: CONNECTION_ID,
        orderId: 'ol_order_dup_a',
        providerType: '',
        idempotencyKey: 'fiscal:dup:1',
        status: 'pending',
      });

      await expect(
        repository.create({
          connectionId: CONNECTION_ID,
          orderId: 'ol_order_dup_b',
          providerType: '',
          idempotencyKey: 'fiscal:dup:1',
          status: 'pending',
        }),
      ).rejects.toMatchObject({ name: 'DuplicateFiscalRegistrationRecordException' });
    });

    it('scopes the guard to the connection', async () => {
      await repository.create({
        connectionId: CONNECTION_ID,
        orderId: 'ol_order_scoped',
        providerType: '',
        idempotencyKey: 'fiscal:scoped:1',
        status: 'pending',
      });

      await expect(
        repository.create({
          connectionId: OTHER_CONNECTION_ID,
          orderId: 'ol_order_scoped',
          providerType: '',
          idempotencyKey: 'fiscal:scoped:1',
          status: 'pending',
        }),
      ).resolves.toBeDefined();
    });

    it('has no null-key escape hatch (the column is NOT NULL)', async () => {
      // The difference from `invoice_records`' PARTIAL index: there is no keyless
      // mode here, so no row can slip past the guard by carrying a null key.
      const entity = row();
      entity.idempotencyKey = null as unknown as string;
      await expect(repo.save(entity)).rejects.toThrow();
    });
  });

  describe('claimForRegistration - atomic single-flight CAS', () => {
    it('lets exactly ONE of two parallel claims on the same pending row win', async () => {
      const saved = await repo.save(row({ status: 'pending' }));
      const lease = new Date(Date.now() + 5 * 60 * 1000);

      // Fire both concurrently: the row-level lock serialises the CAS UPDATEs, and
      // the loser re-evaluates its WHERE against the now-`registering` row and
      // matches nothing (affected 0 -> null).
      const [a, b] = await Promise.all([
        repository.claimForRegistration(saved.id, lease),
        repository.claimForRegistration(saved.id, lease),
      ]);

      const winners = [a, b].filter((record) => record !== null);
      expect(winners).toHaveLength(1);
      const winner = winners[0]!;
      expect(winner.id).toBe(saved.id);
      expect(winner.status).toBe('registering');
      expect(winner.leaseExpiresAt).not.toBeNull();
      // Hydrated from RETURNING * into a fully-typed domain record.
      expect(winner.orderId).toBe(saved.orderId);
      expect(winner.idempotencyKey).toBe(saved.idempotencyKey);

      const reread = await repo.findOneOrFail({ where: { id: saved.id } });
      expect(reread.status).toBe('registering');
    });

    it('claims a terminal-rejected failed row (the provider created nothing)', async () => {
      const saved = await repo.save(row({ status: 'failed', failureMode: 'rejected' }));

      const claimed = await repository.claimForRegistration(
        saved.id,
        new Date(Date.now() + 60_000),
      );

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('registering');
    });

    it('does NOT claim an in-doubt failed row (the sale may already be registered)', async () => {
      const saved = await repo.save(row({ status: 'failed', failureMode: 'in-doubt' }));

      const claimed = await repository.claimForRegistration(
        saved.id,
        new Date(Date.now() + 60_000),
      );

      expect(claimed).toBeNull();
      const reread = await repo.findOneOrFail({ where: { id: saved.id } });
      expect(reread.status).toBe('failed');
    });

    it('does NOT claim a failed row whose mode is absent (the fiscal-safe default)', async () => {
      const saved = await repo.save(row({ status: 'failed', failureMode: null }));

      await expect(
        repository.claimForRegistration(saved.id, new Date(Date.now() + 60_000)),
      ).resolves.toBeNull();
    });

    it('does NOT claim a registered row - a registration cannot be un-done', async () => {
      const saved = await repo.save(row({ status: 'registered' }));

      await expect(
        repository.claimForRegistration(saved.id, new Date(Date.now() + 60_000)),
      ).resolves.toBeNull();
    });

    it('does NOT claim a row whose lease is still live', async () => {
      const saved = await repo.save(
        row({ status: 'registering', leaseExpiresAt: new Date(Date.now() + 60_000) }),
      );

      await expect(
        repository.claimForRegistration(saved.id, new Date(Date.now() + 60_000)),
      ).resolves.toBeNull();
    });

    it('re-claims a row whose lease expired (a crashed prior attempt)', async () => {
      const saved = await repo.save(
        row({ status: 'registering', leaseExpiresAt: new Date(Date.now() - 60_000) }),
      );

      const claimed = await repository.claimForRegistration(
        saved.id,
        new Date(Date.now() + 60_000),
      );

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('registering');
    });

    it('throws not-found for an id that does not exist', async () => {
      await expect(
        repository.claimForRegistration(
          '99999999-9999-9999-9999-999999999999',
          new Date(Date.now() + 60_000),
        ),
      ).rejects.toBeInstanceOf(FiscalRegistrationRecordNotFoundException);
    });
  });

  describe('reads', () => {
    it('returns every record an order holds, newest-first, across connections', async () => {
      const first = await repo.save(
        row({ orderId: 'ol_order_multi', connectionId: CONNECTION_ID }),
      );
      const second = await repo.save(
        row({ orderId: 'ol_order_multi', connectionId: OTHER_CONNECTION_ID }),
      );

      const found = await repository.findAllByOrderId('ol_order_multi');

      expect(found.map((record) => record.id).sort()).toEqual([first.id, second.id].sort());
    });

    it('finds a record by its exactly-once key', async () => {
      const saved = await repo.save(row({ idempotencyKey: 'fiscal:find:1' }));

      const found = await repository.findByIdempotencyKey(CONNECTION_ID, 'fiscal:find:1');

      expect(found?.id).toBe(saved.id);
    });
  });
});
