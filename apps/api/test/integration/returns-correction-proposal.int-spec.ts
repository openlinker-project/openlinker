/**
 * Return Correction Proposal Integration Test (#2374, `W2-38`, ADR-060 / ADR-044)
 *
 * Three properties earn integration coverage because a unit spec cannot reach
 * them:
 *
 *  - **the boot-time DI gate** — `RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN`
 *    resolves off the real api graph. This slice adds `ReturnsModule -> InvoicingModule`,
 *    the FIFTH outbound edge of this context, and Nest imports are not transitive
 *    while DI wiring is invisible to the compiler — a missing import or a
 *    circular one surfaces only here. It is the same reason
 *    `invoicing-auto-issue-boot.int-spec.ts` exists for the invoicing↔orders edge.
 *
 *  - **two returns on ONE order do not collide on the ADR-044 slot** — the whole
 *    reason `targetRef` is `correction:{returnId}:{invoiceRecordId}` rather than
 *    the invoice id. `UQ_order_changes_open_target` is a real PARTIAL UNIQUE
 *    INDEX carrying no `kind` column, so the collision (and the absence of one)
 *    is a property of Postgres, not of a mock. Partial returns arriving in waves
 *    are ordinary, and a collision would have return B silently terminalise a
 *    proposal return A's operator was mid-review on.
 *
 *  - **the `no-line-snapshot` refusal against a real row** — a pre-#1297 record
 *    is a NULL jsonb column, and the refusal (rather than a reconstruction from
 *    the order's current state) is the rule #1297 exists to enforce.
 *
 * Nothing here issues a document: the proposal path resolves no adapter, and the
 * `order_changes` row stays OPEN for the operator's confirmed act (#2376).
 *
 * @module apps/api/test/integration
 */
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { InvoiceRecordOrmEntity } from '@openlinker/core/invoicing/orm-entities';
import {
  RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN,
  RETURN_CUSTODY_SERVICE_TOKEN,
  RETURNS_SERVICE_TOKEN,
  type IReturnCorrectionProposalService,
  type IReturnCustodyService,
  type IReturnsService,
  type IncomingReturn,
} from '@openlinker/core/returns';

import { createTestConnection } from './helpers/test-connection.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

process.env.OL_PII_HASH_SALT = process.env.OL_PII_HASH_SALT ?? 'returns-correction-int-spec-salt';

const EXTERNAL_ORDER_ID = 'EXT-ORDER-CORR-1';

describe('Return Correction Proposal Integration', () => {
  let harness: IntegrationTestHarness;
  let connectionId: string;

  const proposals = (): IReturnCorrectionProposalService =>
    harness
      .getApp()
      .get<IReturnCorrectionProposalService>(RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN, {
        strict: false,
      });

  const returns = (): IReturnsService =>
    harness.getApp().get<IReturnsService>(RETURNS_SERVICE_TOKEN, { strict: false });

  const custody = (): IReturnCustodyService =>
    harness.getApp().get<IReturnCustodyService>(RETURN_CUSTODY_SERVICE_TOKEN, { strict: false });

  const observation = (externalReturnId: string): IncomingReturn => ({
    externalReturnId,
    externalOrderId: EXTERNAL_ORDER_ID,
    rawStatus: 'DELIVERED',
    createdAt: '2026-08-01T10:00:00.000Z',
    lines: [{ quantity: 2, reasonRaw: 'withdrawal', name: 'Widget', sku: 'W-1' }],
  });

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    connectionId = (await createTestConnection(harness.getDataSource(), { name: 'Source A' })).id;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  /**
   * Attribution is a lookup, never a mint — the order's identifier mapping must
   * exist BEFORE the observation is ingested, or the row is an orphan forever.
   */
  const seedAttributedReturn = async (
    externalReturnId: string
  ): Promise<{ returnId: string; internalOrderId: string }> => {
    const internalOrderId = await harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN, { strict: false })
      .getOrCreateInternalId(CORE_ENTITY_TYPE.Order, EXTERNAL_ORDER_ID, connectionId);

    const { record } = await returns().upsertFromObservation(
      connectionId,
      observation(externalReturnId)
    );

    return { returnId: record.id, internalOrderId };
  };

  /**
   * Receive and SCRAP the line, which is what puts units into the counters.
   * Scrap deliberately, not restock: scrap "writes nothing outside OL", so the
   * fixture needs no inventory master and this spec stays about the proposal.
   */
  const disposeFirstLine = async (returnId: string, quantity: number): Promise<void> => {
    const record = await returns().assertAttributedForTrigger(returnId, 'invoice_correction');
    const lineId = record.lines[0].id;
    await custody().receiveLine(lineId, { quantity });
    await custody().disposeLine(lineId, { quantity, disposition: 'scrap' });
  };

  const seedInvoice = async (
    orderId: string,
    withSnapshot: boolean
  ): Promise<InvoiceRecordOrmEntity> => {
    const repo = harness.getDataSource().getRepository(InvoiceRecordOrmEntity);
    // One entity, explicitly — `create()` is overloaded and an inferred object
    // literal resolves the array form, whose `save()` returns an array.
    const entity: InvoiceRecordOrmEntity = repo.create({
        connectionId,
        orderId,
        providerType: 'test-provider',
        documentType: 'invoice',
        status: 'issued',
        documentNumber: 'FV/1/2026',
        issuedAt: new Date('2026-08-02T09:00:00.000Z'),
        issuedLineSnapshot: withSnapshot
          ? {
              buyer: {
                name: 'Buyer',
                taxId: null,
                address: { countryIso2: 'PL' },
                type: 'private',
                email: null,
              },
              currency: 'PLN',
              lines: [{ name: 'Widget', quantity: 3, unitPriceGross: 100, taxRate: '23' }],
            }
          : null,
    });
    return repo.save(entity);
  };

  it('should resolve the proposal service off the real api graph', () => {
    expect(proposals()).toBeDefined();
    expect(typeof proposals().buildProposal).toBe('function');
  });

  it('should propose a correction and leave the ADR-044 row OPEN for the operator', async () => {
    const { returnId, internalOrderId } = await seedAttributedReturn('RET-CORR-1');
    await seedInvoice(internalOrderId, true);
    await disposeFirstLine(returnId, 2);

    const result = await proposals().buildProposal({ returnId, actorUserId: null });

    expect(result.outcome).toBe('proposed');
    expect(result.changeId).not.toBeNull();
    expect(result.proposal?.lines[0].status).toBe('matched');
    // 3 invoiced - 2 returned. Quantity only: core computes no money.
    expect(result.proposal?.lines[0].newQuantity).toBe(1);

    // The row is OPEN, holding its slot until the operator confirms (#2376).
    const rows: Array<{ status: string; target_ref: string }> = await harness
      .getDataSource()
      .query('SELECT status, "targetRef" AS target_ref FROM order_changes WHERE kind = $1', [
        'return.invoice_correction',
      ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('requested');
    expect(rows[0].target_ref).toContain(returnId);
  });

  it('should let TWO returns on one order each hold their own open proposal slot', async () => {
    // The reason `targetRef` is `correction:{returnId}:{invoiceRecordId}` rather
    // than the invoice id. `UQ_order_changes_open_target` is a real partial
    // unique index carrying no `kind`, so this is a Postgres property.
    const first = await seedAttributedReturn('RET-CORR-A');
    await seedInvoice(first.internalOrderId, true);
    await disposeFirstLine(first.returnId, 2);

    const { record: secondRecord } = await returns().upsertFromObservation(
      connectionId,
      observation('RET-CORR-B')
    );
    await disposeFirstLine(secondRecord.id, 2);

    const a = await proposals().buildProposal({ returnId: first.returnId, actorUserId: null });
    const b = await proposals().buildProposal({ returnId: secondRecord.id, actorUserId: null });

    expect(a.outcome).toBe('proposed');
    expect(b.outcome).toBe('proposed');
    expect(a.changeId).not.toBe(b.changeId);

    const open: Array<{ id: string }> = await harness
      .getDataSource()
      .query(
        `SELECT id FROM order_changes WHERE kind = $1 AND status IN ('pending','requested')`,
        ['return.invoice_correction']
      );
    // Both survive. Keyed on the invoice id alone, the second would have
    // terminalised the first.
    expect(open).toHaveLength(2);
  });

  it('should REFUSE a pre-#1297 document rather than diff against the order current state', async () => {
    const { returnId, internalOrderId } = await seedAttributedReturn('RET-CORR-2');
    await seedInvoice(internalOrderId, false);
    await disposeFirstLine(returnId, 2);

    const result = await proposals().buildProposal({ returnId, actorUserId: null });

    expect(result.outcome).toBe('no-line-snapshot');
    expect(result.proposal).toBeNull();
    expect(result.changeId).toBeNull();
  });

  it('should report no-invoice when the order carries no issued document', async () => {
    const { returnId } = await seedAttributedReturn('RET-CORR-3');
    await disposeFirstLine(returnId, 2);

    const result = await proposals().buildProposal({ returnId, actorUserId: null });

    expect(result.outcome).toBe('no-invoice');
    expect(result.proposal).toBeNull();
    expect(result.changeId).toBeNull();
  });
});
