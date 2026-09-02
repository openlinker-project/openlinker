/**
 * Return Writes Controller — unit tests (#2376)
 *
 * Covers the two acceptance criteria a controller can own — a blocked restock
 * answers 2xx carrying quantity/sku/connection name, and the actor is never
 * taken from the body — plus the refund route's three-way outcome, which is the
 * one place this controller makes a decision rather than delegating.
 *
 * Mocks the service INTERFACES directly (the `returns.controller.spec.ts` style)
 * rather than booting a Nest module: the guards are declarative metadata and are
 * asserted as such.
 *
 * @module apps/api/src/returns/http
 */
import 'reflect-metadata';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { ReturnLineNotFoundError, ReturnNotFoundError } from '@openlinker/core/returns';
import { ReturnWritesController } from './return-writes.controller';

const USER: AuthenticatedUser = { id: 'user-7' } as AuthenticatedUser;
const RETURN_ID = 'ol_return_1';
const LINE_ID = 'rl-1';

function buildLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LINE_ID,
    quantityAdvised: 3,
    quantityReceived: 2,
    quantityRestocked: 0,
    quantityScrapped: 0,
    custodyState: 'received',
    moneyState: 'not_refundable',
    disposition: null,
    receivedAt: new Date('2026-08-01T10:00:00.000Z'),
    disposedAt: null,
    ...overrides,
  };
}

describe('ReturnWritesController', () => {
  let returns: Record<string, jest.Mock>;
  let custody: Record<string, jest.Mock>;
  let authorizeService: Record<string, jest.Mock>;
  let refunds: Record<string, jest.Mock>;
  let proposals: Record<string, jest.Mock>;
  let orderRefunds: Record<string, jest.Mock>;
  let controller: ReturnWritesController;

  beforeEach(() => {
    returns = {
      recordReturn: jest.fn(),
      matchOrphanToOrder: jest.fn(),
      // The nested-route check. Default: the line belongs to the return.
      getReturn: jest.fn().mockResolvedValue({ id: RETURN_ID, lines: [{ id: LINE_ID }] }),
    };
    custody = {
      receiveLine: jest.fn(),
      disposeLine: jest.fn(),
      markStockHandledManually: jest.fn(),
    };
    authorizeService = { authorize: jest.fn() };
    refunds = { triggerRefund: jest.fn() };
    proposals = { buildProposal: jest.fn(), previewProposal: jest.fn() };
    orderRefunds = { recordRefund: jest.fn() };

    controller = new ReturnWritesController(
      returns as never,
      custody as never,
      authorizeService as never,
      refunds as never,
      proposals as never,
      orderRefunds as never
    );
  });

  describe('guards', () => {
    const writeRoutes = [
      'record',
      'authorize',
      'matchOrder',
      'receiveLine',
      'disposeLine',
      'markStockHandled',
      'confirmRefund',
      'recordCorrectionProposal',
    ] as const;

    it.each(writeRoutes)('should guard %s with the write roles', (route) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        (ReturnWritesController.prototype as unknown as Record<string, object>)[route]
      );

      // The AC: a read-only role is refused on every write. No new permission
      // value is introduced — this is the existing model the decline route uses.
      expect(roles).toEqual(['admin', 'operator']);
    });

    it('should NOT role-gate the correction-proposal preview', () => {
      // A read. Reads on this resource are authenticated by the global guard and
      // not role-gated — the posture the #2334 read controller established.
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        (ReturnWritesController.prototype as unknown as Record<string, object>)
          .previewCorrectionProposal
      );

      expect(roles).toBeUndefined();
    });
  });

  describe('dispose', () => {
    it('should answer 2xx carrying restockBlocked with quantity, sku and connection name', async () => {
      custody.disposeLine.mockResolvedValue({
        line: buildLine({ quantityRestocked: 0 }),
        event: { id: 'evt-1' },
        restockBlocked: {
          eventId: 'evt-1',
          quantity: 2,
          sku: 'W-1',
          reason: 'master-refused',
          detail: 'PrestaShop said no',
          connectionId: 'conn-1',
          connectionName: 'Main shop',
          state: 'blocked',
        },
      });

      const result = await controller.disposeLine(
        RETURN_ID,
        LINE_ID,
        { quantity: 2, disposition: 'restock' },
        USER
      );

      // The AC: the disposition succeeded and is recorded; only the master write
      // failed — so this is a body, never an error.
      expect(result.restockBlocked).toEqual(
        expect.objectContaining({ quantity: 2, sku: 'W-1', connectionName: 'Main shop' })
      );
      expect(result.eventId).toBe('evt-1');
      // And the counter did NOT move — nothing may report these units restocked.
      expect(result.line.quantityRestocked).toBe(0);
    });

    it('should report null restockBlocked on an applied disposition', async () => {
      custody.disposeLine.mockResolvedValue({
        line: buildLine({ quantityScrapped: 2, disposition: 'scrap' }),
        event: { id: 'evt-2' },
        restockBlocked: null,
      });

      const result = await controller.disposeLine(
        RETURN_ID,
        LINE_ID,
        { quantity: 2, disposition: 'scrap' },
        USER
      );

      expect(result.restockBlocked).toBeNull();
    });

    it('should take the actor from the token, never the body', async () => {
      custody.disposeLine.mockResolvedValue({
        line: buildLine(),
        event: { id: 'e' },
        restockBlocked: null,
      });

      await controller.disposeLine(
        RETURN_ID,
        LINE_ID,
        { quantity: 1, disposition: 'scrap' },
        USER
      );

      expect(custody.disposeLine).toHaveBeenCalledWith(
        LINE_ID,
        expect.objectContaining({ actorUserId: 'user-7' })
      );
    });
  });

  describe('the nested route verifies its nesting', () => {
    it('should refuse a line that belongs to a DIFFERENT return', async () => {
      returns.getReturn.mockResolvedValue({ id: RETURN_ID, lines: [{ id: 'someone-elses-line' }] });

      // The custody service keys on `lineId` alone, so without this check the
      // write would succeed against another return's line and the URL would be
      // a lie the audit trail then records.
      await expect(
        controller.receiveLine(RETURN_ID, LINE_ID, { quantity: 1 }, USER)
      ).rejects.toBeInstanceOf(ReturnLineNotFoundError);

      expect(custody.receiveLine).not.toHaveBeenCalled();
    });

    it('should refuse an unknown return', async () => {
      returns.getReturn.mockResolvedValue(null);

      await expect(
        controller.disposeLine(RETURN_ID, LINE_ID, { quantity: 1, disposition: 'scrap' }, USER)
      ).rejects.toBeInstanceOf(ReturnNotFoundError);

      expect(custody.disposeLine).not.toHaveBeenCalled();
    });

    it('should check BEFORE the write on all three per-line routes', async () => {
      returns.getReturn.mockResolvedValue({ id: RETURN_ID, lines: [] });

      await expect(
        controller.markStockHandled(RETURN_ID, LINE_ID, {}, USER)
      ).rejects.toBeInstanceOf(ReturnLineNotFoundError);

      expect(custody.markStockHandledManually).not.toHaveBeenCalled();
    });
  });

  describe('confirmRefund', () => {
    const body = { amount: '19.99', currency: 'PLN', reason: 'other' as const };

    it('should write the linked RefundRecord when money moved', async () => {
      refunds.triggerRefund.mockResolvedValue({
        moneyState: 'triggered',
        claimedLineIds: ['b', 'a'],
        providerMessage: null,
        refundRecordIntent: {
          returnId: RETURN_ID,
          internalOrderId: 'ol_order_1',
          amount: '19.99',
          currency: 'PLN',
          reason: 'other',
          note: null,
          executedBy: 'operator_out_of_band',
          recordedAt: new Date('2026-08-02T00:00:00.000Z'),
          providerRefundId: null,
        },
      });
      orderRefunds.recordRefund.mockResolvedValue({ id: 'refund-1' });

      const result = await controller.confirmRefund(RETURN_ID, body, USER);

      expect(result.moneyMoved).toBe(true);
      expect(result.refundRecordWritten).toBe(true);
      expect(result.refundRecordId).toBe('refund-1');
      // Deterministic per attempt, and order-independent, so one attempt cannot
      // insert twice and inflate the order's refund total.
      expect(orderRefunds.recordRefund).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: `return:${RETURN_ID}:a+b` })
      );
    });

    it('should report moneyMoved:false without writing when no money moved', async () => {
      refunds.triggerRefund.mockResolvedValue({
        moneyState: 'denied',
        claimedLineIds: [],
        providerMessage: 'Source refused',
        refundRecordIntent: null,
      });

      const result = await controller.confirmRefund(RETURN_ID, body, USER);

      expect(result.moneyMoved).toBe(false);
      expect(result.refundRecordWritten).toBe(false);
      expect(result.refundRecordError).toBeNull();
      expect(orderRefunds.recordRefund).not.toHaveBeenCalled();
    });

    it('should answer 2xx when the record write fails, because the money state already settled', async () => {
      refunds.triggerRefund.mockResolvedValue({
        moneyState: 'triggered',
        claimedLineIds: ['a'],
        providerMessage: null,
        refundRecordIntent: {
          returnId: RETURN_ID,
          internalOrderId: 'ol_order_1',
          amount: '19.99',
          currency: 'PLN',
          reason: 'other',
          note: null,
          executedBy: 'operator_out_of_band',
          recordedAt: new Date(),
          providerRefundId: null,
        },
      });
      orderRefunds.recordRefund.mockRejectedValue(new Error('connection reset'));

      const result = await controller.confirmRefund(RETURN_ID, body, USER);

      // Propagating would claim the refund failed when it did not — and the
      // operator's retry would then answer 409 `already-attempted`.
      expect(result.moneyMoved).toBe(true);
      expect(result.refundRecordWritten).toBe(false);
      expect(result.refundRecordError).toBe('connection reset');
      expect(result.moneyState).toBe('triggered');
    });

    it('should never roll the money state back on a failed record write', async () => {
      refunds.triggerRefund.mockResolvedValue({
        moneyState: 'triggered',
        claimedLineIds: ['a'],
        providerMessage: null,
        refundRecordIntent: {
          returnId: RETURN_ID,
          internalOrderId: 'o',
          amount: '1.00',
          currency: 'PLN',
          reason: 'other',
          note: null,
          executedBy: 'operator_out_of_band',
          recordedAt: new Date(),
          providerRefundId: null,
        },
      });
      orderRefunds.recordRefund.mockRejectedValue(new Error('boom'));

      await controller.confirmRefund(RETURN_ID, body, USER);

      // There is no compensating call, and there must not be: "recorded but
      // still refundable" is the worse of the two survivable failures.
      expect(refunds.triggerRefund).toHaveBeenCalledTimes(1);
    });
  });

  describe('correction proposal', () => {
    const proposalResult = {
      outcome: 'proposed' as const,
      changeId: 'chg-1',
      opened: true,
      proposal: {
        returnId: RETURN_ID,
        internalOrderId: 'ol_order_1',
        invoiceRecordId: 'inv-1',
        invoiceConnectionId: 'conn-inv',
        invoiceDocumentNumber: 'FV/1/2026',
        currency: 'PLN',
        lines: [
          {
            returnLineId: LINE_ID,
            lineIndex: 0,
            name: 'Widget',
            sku: 'W-1',
            quantityDisposed: 2,
            status: 'ambiguous' as const,
            candidates: [
              { originalLineNumber: 1, name: 'Widget', quantity: 3, unitPriceGross: 100, taxRate: '23' },
              { originalLineNumber: 2, name: 'Widget', quantity: 3, unitPriceGross: 100, taxRate: '23' },
            ],
            selectedOriginalLineNumber: null,
            newQuantity: null,
            noMatchReason: null,
            candidatesPriceOrRateDiffer: false,
          },
        ],
      },
    };

    it('should preview without recording', async () => {
      proposals.previewProposal.mockResolvedValue({
        ...proposalResult,
        changeId: null,
        opened: false,
      });

      const result = await controller.previewCorrectionProposal(RETURN_ID);

      expect(proposals.previewProposal).toHaveBeenCalledWith(RETURN_ID);
      expect(proposals.buildProposal).not.toHaveBeenCalled();
      expect(result.changeId).toBeNull();
    });

    it('should list EVERY candidate and select none on an ambiguous line', async () => {
      proposals.buildProposal.mockResolvedValue(proposalResult);

      const result = await controller.recordCorrectionProposal(RETURN_ID, USER);

      const [line] = result.proposal?.lines ?? [];
      expect(line.status).toBe('ambiguous');
      expect(line.candidates).toHaveLength(2);
      expect(line.selectedOriginalLineNumber).toBeNull();
    });

    it('should resolve a no-match explanation from the core helper', async () => {
      proposals.buildProposal.mockResolvedValue({
        ...proposalResult,
        outcome: 'nothing-correctable' as const,
        changeId: null,
        opened: false,
        proposal: {
          ...proposalResult.proposal,
          lines: [
            {
              ...proposalResult.proposal.lines[0],
              status: 'no-match' as const,
              candidates: [],
              noMatchReason: 'disposition-not-confirmed' as const,
            },
          ],
        },
      });

      const result = await controller.recordCorrectionProposal(RETURN_ID, USER);

      // Copy comes from `describeCorrectionNoMatchReason`, never re-authored
      // here — two copies would drift on the first reword.
      expect(result.proposal?.lines[0].noMatchExplanation).toContain('Attest');
    });

    it('should carry no explanation on a line that matched', async () => {
      proposals.buildProposal.mockResolvedValue(proposalResult);

      const result = await controller.recordCorrectionProposal(RETURN_ID, USER);

      expect(result.proposal?.lines[0].noMatchExplanation).toBeNull();
    });
  });

  describe('record / authorize / match', () => {
    it('should open an operator-authored return from the token actor', async () => {
      returns.recordReturn.mockResolvedValue({
        id: RETURN_ID,
        internalOrderId: 'ol_order_1',
        origin: 'operator_authored',
        openedAt: new Date('2026-08-01T00:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      });

      const result = await controller.record(
        {
          internalOrderId: 'ol_order_1',
          sourceConnectionId: 'conn-1',
          lines: [{ reason: 'other', quantityAdvised: 1 }],
        },
        USER
      );

      expect(result.origin).toBe('operator_authored');
      expect(returns.recordReturn).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'user-7' })
      );
    });

    it('should report the authorize outcome verbatim', async () => {
      authorizeService.authorize.mockResolvedValue({
        outcome: 'already-authorized',
        changeId: 'chg-9',
        authorizedAt: new Date('2026-08-01T00:00:00.000Z'),
      });

      const result = await controller.authorize(RETURN_ID, USER);

      expect(result.outcome).toBe('already-authorized');
      expect(result.authorizedAt).toBe('2026-08-01T00:00:00.000Z');
    });

    it('should return the attributed order after a match', async () => {
      returns.matchOrphanToOrder.mockResolvedValue({
        id: RETURN_ID,
        internalOrderId: 'ol_order_9',
        matchedAt: new Date('2026-08-03T00:00:00.000Z'),
      });

      const result = await controller.matchOrder(RETURN_ID, { internalOrderId: 'ol_order_9' }, USER);

      expect(result.internalOrderId).toBe('ol_order_9');
      expect(result.matchedAt).toBe('2026-08-03T00:00:00.000Z');
    });
  });
});
