/**
 * Invoice Marketplace Upload Repository Integration Test (#3549)
 *
 * The whole at-most-once guarantee of the marketplace upload lives in two raw
 * statements: the `INSERT ... ON CONFLICT DO UPDATE ... WHERE` claim and the
 * guarded outcome UPDATE. A mock of the repository cannot say whether that SQL
 * means what its comments say, so it is asserted here against real Postgres
 * (Testcontainers).
 *
 * **The port is resolved from the container by its Symbol token**, the
 * `order-holds.int-spec.ts` shape: constructing the repository directly would
 * need a deep import of `@openlinker/core/orders/infrastructure/...`, which
 * `.eslintrc.js` bans for `apps/**` (#591).
 *
 * @module apps/api/test/integration/orders
 */
import {
  INVOICE_MARKETPLACE_UPLOAD_REPOSITORY_TOKEN,
  UPLOAD_CLAIM_LEASE_MS,
  type InvoiceMarketplaceUpload,
  type RecordInvoiceMarketplaceUploadOutcome,
} from '@openlinker/core/orders';
import {
  getTestHarness,
  type IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';

describe('Invoice Marketplace Upload Repository Integration (#3549)', () => {
  let harness: IntegrationTestHarness;
  // Typed structurally: the repository port is intra-context and not exported.
  let repository: {
    claimAttempt(
      invoiceRecordId: string,
      targetConnectionId: string,
    ): Promise<InvoiceMarketplaceUpload | null>;
    recordOutcome(
      id: string,
      claimedAttempt: number,
      outcome: RecordInvoiceMarketplaceUploadOutcome,
    ): Promise<boolean>;
    findByInvoiceId(invoiceRecordId: string): Promise<InvoiceMarketplaceUpload[]>;
  };

  const INVOICE = '11111111-1111-4111-8111-111111111111';
  const TARGET = '22222222-2222-4222-8222-222222222222';
  const OTHER_TARGET = '33333333-3333-4333-8333-333333333333';

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(() => {
    repository = harness
      .getApp()
      .get(INVOICE_MARKETPLACE_UPLOAD_REPOSITORY_TOKEN, { strict: false });
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** Push a row's last write into the past, so its claim lease has run out. */
  const ageRow = async (id: string, byMs: number): Promise<void> => {
    await harness
      .getDataSource()
      .query(
        `UPDATE "invoice_marketplace_uploads" SET "updatedAt" = now() - make_interval(secs => $2) WHERE "id" = $1`,
        [id, byMs / 1000],
      );
  };

  /** Claim, then settle the row in the given state. */
  const settled = async (
    outcome: RecordInvoiceMarketplaceUploadOutcome,
  ): Promise<InvoiceMarketplaceUpload> => {
    const claimed = await repository.claimAttempt(INVOICE, TARGET);
    if (claimed === null) throw new Error('fixture: first claim must succeed');
    expect(await repository.recordOutcome(claimed.id, claimed.attempts, outcome)).toBe(true);
    return claimed;
  };

  describe('claimAttempt', () => {
    it('should create a pending row on the first claim', async () => {
      const claimed = await repository.claimAttempt(INVOICE, TARGET);

      expect(claimed).toMatchObject({
        invoiceRecordId: INVOICE,
        targetConnectionId: TARGET,
        status: 'pending',
        attempts: 1,
      });
    });

    it.each([
      ['failed', { status: 'failed', lastFailureCode: 'transient' }],
      ['no-file', { status: 'no-file' }],
    ] as const)('should claim a %s row again and count the attempt', async (_label, outcome) => {
      await settled(outcome);

      const again = await repository.claimAttempt(INVOICE, TARGET);

      expect(again).toMatchObject({ status: 'pending', attempts: 2 });
    });

    it.each([
      ['uploaded', { status: 'uploaded' }],
      ['unsupported', { status: 'unsupported' }],
    ] as const)('should never claim a %s row', async (_label, outcome) => {
      await settled(outcome);

      expect(await repository.claimAttempt(INVOICE, TARGET)).toBeNull();
      const [row] = await repository.findByInvoiceId(INVOICE);
      expect(row).toMatchObject({ status: outcome.status, attempts: 1 });
    });

    it('should not claim a pending row another attempt still holds', async () => {
      await repository.claimAttempt(INVOICE, TARGET);

      expect(await repository.claimAttempt(INVOICE, TARGET)).toBeNull();
    });

    it('should take over a pending row whose lease ran out', async () => {
      const first = await repository.claimAttempt(INVOICE, TARGET);
      await ageRow(first!.id, UPLOAD_CLAIM_LEASE_MS + 60_000);

      const takeover = await repository.claimAttempt(INVOICE, TARGET);

      expect(takeover).toMatchObject({ id: first!.id, status: 'pending', attempts: 2 });
    });

    it('should let exactly one of two concurrent first claims win', async () => {
      const results = await Promise.all([
        repository.claimAttempt(INVOICE, TARGET),
        repository.claimAttempt(INVOICE, TARGET),
      ]);

      expect(results.filter((row) => row !== null)).toHaveLength(1);
      expect(await repository.findByInvoiceId(INVOICE)).toHaveLength(1);
    });

    it('should let exactly one of two concurrent retries of a failed row win', async () => {
      await settled({ status: 'failed', lastFailureCode: 'transient' });

      const results = await Promise.all([
        repository.claimAttempt(INVOICE, TARGET),
        repository.claimAttempt(INVOICE, TARGET),
      ]);

      expect(results.filter((row) => row !== null)).toHaveLength(1);
    });

    it('should keep one row per target connection', async () => {
      await repository.claimAttempt(INVOICE, TARGET);
      await repository.claimAttempt(INVOICE, OTHER_TARGET);

      const rows = await repository.findByInvoiceId(INVOICE);
      expect(rows.map((row) => row.targetConnectionId).sort()).toEqual(
        [TARGET, OTHER_TARGET].sort(),
      );
    });
  });

  describe('recordOutcome', () => {
    it('should settle a claimed row and stamp uploadedAt on success', async () => {
      const claimed = await repository.claimAttempt(INVOICE, TARGET);

      expect(await repository.recordOutcome(claimed!.id, 1, { status: 'uploaded' })).toBe(true);

      const [row] = await repository.findByInvoiceId(INVOICE);
      expect(row.status).toBe('uploaded');
      expect(row.uploadedAt).toBeInstanceOf(Date);
    });

    it('should not overwrite a row that is already settled', async () => {
      const claimed = await settled({ status: 'uploaded' });

      expect(
        await repository.recordOutcome(claimed.id, claimed.attempts, {
          status: 'failed',
          lastFailureCode: 'transient',
        }),
      ).toBe(false);
      const [row] = await repository.findByInvoiceId(INVOICE);
      expect(row.status).toBe('uploaded');
    });

    it('should not let an attempt whose lease was taken over settle the newer one', async () => {
      const stale = await repository.claimAttempt(INVOICE, TARGET);
      await ageRow(stale!.id, UPLOAD_CLAIM_LEASE_MS + 60_000);
      const current = await repository.claimAttempt(INVOICE, TARGET);

      // The stale attempt finally answers: it must not decide the row.
      expect(
        await repository.recordOutcome(stale!.id, stale!.attempts, {
          status: 'failed',
          lastFailureCode: 'transient',
        }),
      ).toBe(false);
      expect(
        await repository.recordOutcome(current!.id, current!.attempts, { status: 'uploaded' }),
      ).toBe(true);
      const [row] = await repository.findByInvoiceId(INVOICE);
      expect(row).toMatchObject({ status: 'uploaded', attempts: 2 });
    });

    it('should persist only the failure code', async () => {
      const claimed = await repository.claimAttempt(INVOICE, TARGET);

      await repository.recordOutcome(claimed!.id, 1, {
        status: 'failed',
        lastFailureCode: 'order-unmapped',
      });

      const [row] = await repository.findByInvoiceId(INVOICE);
      expect(row).toMatchObject({ status: 'failed', lastFailureCode: 'order-unmapped' });
    });
  });
});
