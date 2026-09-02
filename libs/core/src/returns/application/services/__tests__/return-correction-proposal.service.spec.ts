/**
 * Return Correction Proposal Service Tests (#2374, ADR-060 / ADR-044)
 *
 * Covers every `outcome` arm, the ADR-044 recording rules, and the acceptance
 * criterion that matters most: **a proposal never issues anything**.
 *
 * @module libs/core/src/returns/application/services/__tests__
 */
import type { IInvoiceService } from '@openlinker/core/invoicing';
import type { IOrderChangeService, OrderChange } from '@openlinker/core/orders';
import { ReturnLine } from '../../../domain/entities/return-line.entity';
import { ReturnRecord } from '../../../domain/entities/return-record.entity';
import { ReturnNotAttributedError } from '../../../domain/exceptions/return-not-attributed.error';
import type { ReturnLineEvent } from '../../../domain/entities/return-line-event.entity';
import type { ReturnRepositoryPort } from '../../../domain/ports/return-repository.port';
import {
  ReturnCorrectionProposalService,
  __canonicalJsonForTests,
} from '../return-correction-proposal.service';
import { ReturnsService } from '../returns.service';

const RETURN_ID = 'ol_return_corr';
const ORDER_ID = 'ol_order_corr';
const CONNECTION_ID = 'conn-corr';
const INVOICE_ID = 'invoice-1';

function buildLine(overrides: Partial<Record<string, unknown>> = {}): ReturnLine {
  const o = overrides as {
    id?: string;
    lineIndex?: number;
    name?: string | null;
    quantityRestocked?: number;
    quantityScrapped?: number;
  };
  return new ReturnLine(
    o.id ?? 'rl-1',
    RETURN_ID,
    o.lineIndex ?? 0,
    null,
    null,
    null,
    'W-1',
    o.name === undefined ? 'Widget' : o.name,
    'other',
    3,
    3,
    o.quantityRestocked ?? 1,
    o.quantityScrapped ?? 0,
    'disposed',
    'not_refundable',
    'restock',
    null,
    null,
    null,
    new Date(),
    new Date()
  );
}

function buildReturn(lines: ReturnLine[], internalOrderId: string | null = ORDER_ID): ReturnRecord {
  return new ReturnRecord(
    RETURN_ID,
    CONNECTION_ID,
    null,
    internalOrderId,
    null,
    'source_ingested',
    null,
    null,
    new Date(),
    null,
    null,
    null,
    new Date(),
    new Date(),
    lines
  );
}

function buildInvoice(overrides: { snapshot?: unknown } = {}): unknown {
  return {
    id: INVOICE_ID,
    connectionId: 'conn-invoicing',
    documentNumber: 'FV/1/2026',
    status: 'issued',
    issuedLineSnapshot:
      overrides.snapshot === undefined
        ? {
            buyer: { name: 'B', taxId: null, address: {}, type: 'individual', email: null },
            currency: 'PLN',
            lines: [{ name: 'Widget', quantity: 3, unitPriceGross: 100, taxRate: '23' }],
          }
        : overrides.snapshot,
  };
}

/**
 * Simulate the jsonb round trip: a deep clone with every object's keys in a
 * DIFFERENT order. Postgres sorts jsonb keys by length then bytewise, so the
 * exact permutation does not matter — only that it is not insertion order.
 */
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => reorderKeys(entry)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, entryValue]) => [key, reorderKeys(entryValue)])
    ) as unknown as T;
  }
  return value;
}

function buildChange(id = 'change-corr-1', payload: Record<string, unknown> | null = null): OrderChange {
  return { id, kind: 'return.invoice_correction', payload } as unknown as OrderChange;
}

describe('ReturnCorrectionProposalService', () => {
  let repository: jest.Mocked<
    Pick<ReturnRepositoryPort, 'findById' | 'findOutstandingRestockEventsForReturn'>
  >;
  let invoices: jest.Mocked<Pick<IInvoiceService, 'getLatestIssuedInvoiceForOrder'>>;
  let orderChanges: jest.Mocked<IOrderChangeService>;
  let service: ReturnCorrectionProposalService;

  const input = { returnId: RETURN_ID, actorUserId: 'user-1' };

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      findOutstandingRestockEventsForReturn: jest.fn().mockResolvedValue([]),
    };

    invoices = {
      getLatestIssuedInvoiceForOrder: jest.fn().mockResolvedValue(buildInvoice()),
    } as unknown as jest.Mocked<Pick<IInvoiceService, 'getLatestIssuedInvoiceForOrder'>>;

    orderChanges = {
      openOrReuse: jest
        .fn()
        .mockResolvedValue({ change: buildChange(), opened: true, expiredStale: false }),
      confirm: jest.fn(),
      decline: jest.fn(),
      abandon: jest.fn().mockResolvedValue(true),
      claimApplied: jest.fn(),
      findLatestByTarget: jest.fn().mockResolvedValue(null),
    };

    // The REAL guard, not a stub — an orphan must be refused through the one seam.
    const returns = new ReturnsService(
      repository as unknown as ReturnRepositoryPort,
      { getInternalId: jest.fn(), getExternalIds: jest.fn() } as never,
      { getAdapter: jest.fn(), listCapabilityAdapters: jest.fn() } as never
    );

    service = new ReturnCorrectionProposalService(
      repository as unknown as ReturnRepositoryPort,
      returns,
      invoices as unknown as IInvoiceService,
      orderChanges
    );
  });

  describe('a proposal never issues anything', () => {
    it('should expose no issuing method and never touch a correction issuer', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));

      await service.buildProposal(input);

      // The service holds `IInvoiceService`, which CAN issue. Assert it is only
      // ever asked to read.
      expect(invoices.getLatestIssuedInvoiceForOrder).toHaveBeenCalledTimes(1);
      expect((invoices as Record<string, unknown>).issueCorrection).toBeUndefined();
      // ADR-044: the row stays OPEN for the operator's confirmed act (#2376).
      expect(orderChanges.confirm).not.toHaveBeenCalled();
      expect(orderChanges.claimApplied).not.toHaveBeenCalled();
    });
  });

  describe('the orphan block', () => {
    it('should refuse an unattributed return through the shared attribution seam', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()], null));

      await expect(service.buildProposal(input)).rejects.toBeInstanceOf(ReturnNotAttributedError);
      expect(invoices.getLatestIssuedInvoiceForOrder).not.toHaveBeenCalled();
    });

    it('should refuse before reading the invoice, so a phantom order is never corrected', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()], null));

      await expect(service.buildProposal(input)).rejects.toThrow();
      expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
    });
  });

  describe('non-proposing outcomes are named, never silent', () => {
    it('should report no-disposed-lines when nothing has been disposed', async () => {
      repository.findById.mockResolvedValue(
        buildReturn([buildLine({ quantityRestocked: 0, quantityScrapped: 0 })])
      );

      const result = await service.buildProposal(input);

      expect(result.outcome).toBe('no-disposed-lines');
      expect(result.proposal).toBeNull();
      expect(result.changeId).toBeNull();
    });

    it('should report no-invoice when the order holds no issued document', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));
      invoices.getLatestIssuedInvoiceForOrder.mockResolvedValue(null);

      const result = await service.buildProposal(input);

      expect(result.outcome).toBe('no-invoice');
      expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
    });

    it('should REFUSE a pre-#1297 document rather than diff against the order current state', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));
      invoices.getLatestIssuedInvoiceForOrder.mockResolvedValue(
        buildInvoice({ snapshot: null }) as never
      );

      const result = await service.buildProposal(input);

      expect(result.outcome).toBe('no-line-snapshot');
      expect(result.proposal).toBeNull();
    });

    it('should report nothing-correctable WITH the full proposal body and open no row', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine({ name: 'Unknown' })]));

      const result = await service.buildProposal(input);

      expect(result.outcome).toBe('nothing-correctable');
      expect(result.changeId).toBeNull();
      expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
      // The operator must still read WHY the line was excluded.
      expect(result.proposal?.lines[0].noMatchReason).toBe('no-line-by-name');
    });
  });

  describe('proposing', () => {
    it('should propose, carry the document identity, and report the outcome', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));

      const result = await service.buildProposal(input);

      expect(result.outcome).toBe('proposed');
      expect(result.proposal?.invoiceRecordId).toBe(INVOICE_ID);
      expect(result.proposal?.invoiceDocumentNumber).toBe('FV/1/2026');
      expect(result.proposal?.currency).toBe('PLN');
      expect(result.proposal?.lines[0].status).toBe('matched');
      expect(result.changeId).toBe('change-corr-1');
      expect(result.opened).toBe(true);
    });

    it('should key targetRef per (return, document) so two returns on one order never collide', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));

      await service.buildProposal(input);

      expect(orderChanges.openOrReuse).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'return.invoice_correction',
          targetRef: `correction:${RETURN_ID}:${INVOICE_ID}`,
          internalOrderId: ORDER_ID,
        })
      );
    });

    it('should propose an ambiguous line without selecting a candidate', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));
      invoices.getLatestIssuedInvoiceForOrder.mockResolvedValue(
        buildInvoice({
          snapshot: {
            buyer: {},
            currency: 'PLN',
            lines: [
              { name: 'Widget', quantity: 3, unitPriceGross: 100, taxRate: '23' },
              { name: 'Widget', quantity: 3, unitPriceGross: 100, taxRate: '23' },
            ],
          },
        }) as never
      );

      const result = await service.buildProposal(input);

      expect(result.outcome).toBe('proposed');
      expect(result.proposal?.lines[0].status).toBe('ambiguous');
      expect(result.proposal?.lines[0].candidates).toHaveLength(2);
      expect(result.proposal?.lines[0].selectedOriginalLineNumber).toBeNull();
    });

    it('should classify a line whose only disposition is unconfirmed, rather than dropping it', async () => {
      // No counter movement — so it is absent from the disposed set — but it is
      // exactly the line the operator must be told to attest.
      repository.findById.mockResolvedValue(
        buildReturn([buildLine({ quantityRestocked: 0, quantityScrapped: 0 })])
      );
      repository.findOutstandingRestockEventsForReturn.mockResolvedValue([
        { returnLineId: 'rl-1' } as ReturnLineEvent,
      ]);

      const result = await service.buildProposal(input);

      expect(result.outcome).toBe('nothing-correctable');
      expect(result.proposal?.lines[0].noMatchReason).toBe('disposition-not-confirmed');
    });
  });

  describe('payload comparison survives the jsonb round trip', () => {
    it('should treat a key-reordered object as identical content', () => {
      const a = { returnId: 'r', lines: [{ status: 'matched', newQuantity: 1 }] };
      const b = { lines: [{ newQuantity: 1, status: 'matched' }], returnId: 'r' };

      // A plain JSON.stringify would disagree here — which is the whole point.
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
      expect(__canonicalJsonForTests(a)).toBe(__canonicalJsonForTests(b));
    });

    it('should still distinguish genuinely different content', () => {
      expect(__canonicalJsonForTests({ a: 1 })).not.toBe(__canonicalJsonForTests({ a: 2 }));
    });

    it('should not confuse an array order change with a key order change', () => {
      expect(__canonicalJsonForTests([1, 2])).not.toBe(__canonicalJsonForTests([2, 1]));
    });
  });

  describe('the persisted row always matches the answer', () => {
    it('should reuse an open row whose payload still matches ACROSS the jsonb round trip', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));
      orderChanges.openOrReuse.mockImplementation((createInput) =>
        Promise.resolve({
          // Postgres jsonb normalises key order rather than preserving insertion
          // order, so the stored value never comes back key-for-key. Echoing the
          // caller's own object reference would test nothing — it is exactly how
          // an order-sensitive comparison stayed invisible in review.
          change: buildChange('change-existing', reorderKeys(createInput.payload)),
          opened: false,
          expiredStale: false,
        })
      );

      const result = await service.buildProposal(input);

      expect(result.changeId).toBe('change-existing');
      expect(result.opened).toBe(false);
      expect(orderChanges.abandon).not.toHaveBeenCalled();
    });

    it('should abandon and replace an open row whose payload has diverged', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));
      orderChanges.openOrReuse
        .mockResolvedValueOnce({
          change: buildChange('change-stale', { returnId: 'something-else' }),
          opened: false,
          expiredStale: false,
        })
        .mockResolvedValueOnce({
          change: buildChange('change-fresh'),
          opened: true,
          expiredStale: false,
        });

      const result = await service.buildProposal(input);

      expect(orderChanges.abandon).toHaveBeenCalledWith('change-stale');
      expect(result.changeId).toBe('change-fresh');
    });

    it('should store no operator picks on the row, so a rebuild cannot destroy them', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));

      await service.buildProposal(input);

      const payload = orderChanges.openOrReuse.mock.calls[0][0].payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('selections');
      expect(payload).not.toHaveProperty('picks');
    });
  });

  describe('previewProposal — the read half (#2376)', () => {
    it('should compute the identical proposal without persisting anything', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));

      const preview = await service.previewProposal(RETURN_ID);

      expect(preview.outcome).toBe('proposed');
      expect(preview.proposal?.lines[0].status).toBe('matched');
      // The whole point: a GET must not write.
      expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
      expect(orderChanges.abandon).not.toHaveBeenCalled();
      expect(preview.changeId).toBeNull();
      expect(preview.opened).toBe(false);
    });

    it('should agree with buildProposal about what the proposal IS', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()]));

      const preview = await service.previewProposal(RETURN_ID);
      const built = await service.buildProposal(input);

      // Structurally guaranteed by the shared private `compute`; asserted so a
      // future divergence is a failing test rather than a support ticket.
      expect(preview.proposal).toEqual(built.proposal);
      expect(preview.outcome).toBe(built.outcome);
    });

    it('should refuse an orphan exactly as the write does', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine()], null));

      await expect(service.previewProposal(RETURN_ID)).rejects.toBeInstanceOf(
        ReturnNotAttributedError
      );
    });

    it('should report a non-proposing outcome without persisting', async () => {
      repository.findById.mockResolvedValue(buildReturn([buildLine({ name: 'Unknown' })]));

      const preview = await service.previewProposal(RETURN_ID);

      expect(preview.outcome).toBe('nothing-correctable');
      expect(preview.proposal?.lines[0].noMatchReason).toBe('no-line-by-name');
      expect(orderChanges.openOrReuse).not.toHaveBeenCalled();
    });
  });
});
