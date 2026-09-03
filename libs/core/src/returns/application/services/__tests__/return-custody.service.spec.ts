/**
 * Return Custody Service — unit tests (#2370)
 *
 * The cases that matter here are the ones where getting it wrong moves, or
 * fails to move, real stock:
 *
 *  - a blocked restock does NOT increment `quantityRestocked` (spec § 5.4);
 *  - the act is persisted BEFORE the adapter call, so a throw mid-call leaves
 *    `in_doubt` rather than silence (the ADR-056 attempted-predicate ordering);
 *  - the counter check runs BEFORE the boundary crossing, so an over-disposition
 *    never reaches the master;
 *  - an orphan return restocks nothing;
 *  - nothing here ever writes a marketplace.
 *
 * @module application/services
 */
import { ReturnLine } from '../../../domain/entities/return-line.entity';
import { ReturnLineEvent } from '../../../domain/entities/return-line-event.entity';
import { ReturnRecord } from '../../../domain/entities/return-record.entity';
import { ReturnCustodyTransitionError } from '../../../domain/exceptions/return-custody-transition.error';
import { ReturnCustodyContendedError } from '../../../domain/exceptions/return-custody-contended.error';
import { ReturnRestockAttestationInvalidError } from '../../../domain/exceptions/return-restock-attestation-invalid.error';
import { ReturnCustodyService } from '../return-custody.service';

const RETURN_ID = 'ol_return_1';
const LINE_ID = 'line-1';

function makeLine(overrides: Partial<ReturnLine> = {}): ReturnLine {
  return new ReturnLine(
    LINE_ID,
    RETURN_ID,
    0,
    null,
    null,
    null,
    'SKU-1',
    'Widget',
    'other',
    overrides.quantityAdvised ?? 5,
    overrides.quantityReceived ?? 0,
    overrides.quantityRestocked ?? 0,
    overrides.quantityScrapped ?? 0,
    overrides.custodyState ?? 'advised',
    'not_refundable',
    null,
    overrides.receivedAt ?? null,
    overrides.disposedAt ?? null,
    null,
    new Date('2026-08-01T00:00:00Z'),
    new Date('2026-08-01T00:00:00Z')
  );
}

function makeRecord(): ReturnRecord {
  return new ReturnRecord(
    RETURN_ID,
    'conn-1',
    'ext-1',
    'ol_order_1',
    'ext-order-1',
    'source_ingested',
    null,
    null,
    null,
    null,
    null,
    null,
    new Date('2026-08-01T00:00:00Z'),
    new Date('2026-08-01T00:00:00Z'),
    []
  );
}

function makeEvent(seq = 1, overrides: Partial<ReturnLineEvent> = {}): ReturnLineEvent {
  return new ReturnLineEvent(
    overrides.id ?? 'event-1',
    RETURN_ID,
    LINE_ID,
    seq,
    overrides.kind ?? 'dispose',
    overrides.quantity ?? 2,
    overrides.disposition ?? 'restock',
    overrides.restockState ?? 'in_doubt',
    overrides.restockBlockedReason ?? null,
    overrides.restockBlockedDetail ?? null,
    overrides.restockedBy ?? null,
    overrides.masterConnectionId ?? null,
    overrides.note ?? null,
    // Honoured rather than hardcoded (#2381): an attestation's whole content is
    // WHO said so and when, so a fixture that pinned this to null could not
    // express the case at all.
    overrides.actorUserId ?? null,
    new Date('2026-08-02T00:00:00Z'),
    overrides.attestedByEventId ?? null,
    new Date('2026-08-02T00:00:00Z')
  );
}

describe('ReturnCustodyService', () => {
  let repository: {
    findLine: jest.Mock;
    runLineWrite: jest.Mock;
    settleLineRestock: jest.Mock;
    findOutstandingRestockEvents: jest.Mock;
    findOutstandingRestockEventsForReturn: jest.Mock;
    findAttestationsForReturn: jest.Mock;
    listLineEvents: jest.Mock;
  };
  let returns: { assertAttributedForTrigger: jest.Mock; getReturn: jest.Mock };
  let integrations: { listCapabilityAdapters: jest.Mock; getAdapter?: jest.Mock };
  let products: { getVariantsBySkus: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock; extend: jest.Mock };
  let adjustInventory: jest.Mock;
  let service: ReturnCustodyService;

  /** The most recent decision the service handed the repository. */
  let lastWrite: {
    event: Record<string, unknown>;
    outcome: Record<string, unknown> | null;
    disposition: string | null;
  } | null;
  let lineState: ReturnLine;
  /** What the settle callback computed against the locked row. */
  let settledOutcome: unknown;

  beforeEach(() => {
    lastWrite = null;
    settledOutcome = undefined;
    lineState = makeLine();

    repository = {
      findLine: jest.fn(() => Promise.resolve({ line: lineState, record: makeRecord() })),
      runLineWrite: jest.fn(
        async (_lineId: string, write: (locked: unknown) => unknown) => {
          const decision = (await write({ line: lineState, record: makeRecord() })) as {
            event: Record<string, unknown>;
            outcome: Record<string, unknown> | null;
            disposition: string | null;
            result: unknown;
          };
          lastWrite = decision;
          return { event: makeEvent(1, decision.event as never), result: decision.result };
        }
      ),
      // Mirrors the real repository: the outcome callback is invoked with the
      // row as it stands under the lock, INSIDE the settle.
      settleLineRestock: jest.fn(
        (
          _eventId: string,
          _lineId: string,
          patch: Record<string, unknown>,
          computeOutcome: (line: ReturnLine) => unknown
        ) => {
          settledOutcome = computeOutcome(lineState);
          return Promise.resolve(makeEvent(1, patch as never));
        }
      ),
      findOutstandingRestockEvents: jest.fn(() => Promise.resolve([])),
      findOutstandingRestockEventsForReturn: jest.fn(() => Promise.resolve([])),
      findAttestationsForReturn: jest.fn(() => Promise.resolve([])),
      listLineEvents: jest.fn(() => Promise.resolve([])),
    };

    returns = {
      assertAttributedForTrigger: jest.fn(() => Promise.resolve(makeRecord())),
      getReturn: jest.fn(() => Promise.resolve(makeRecord())),
    };

    adjustInventory = jest.fn(() =>
      Promise.resolve({
        id: 'inv-1',
        productId: 'ol_product_1',
        quantity: 7,
        reserved: 0,
        available: 7,
        adjustmentOutcome: {
          disposition: 'applied' as const,
          idempotency: 'honoured' as const,
          appliedAt: null,
        },
      })
    );

    integrations = {
      listCapabilityAdapters: jest.fn(() =>
        Promise.resolve([
          {
            connectionId: 'conn-master',
            connection: { id: 'conn-master', name: 'Main shop' },
            adapter: { adjustInventory },
            metadata: {},
          },
        ])
      ),
    };

    products = {
      getVariantsBySkus: jest.fn(() =>
        Promise.resolve([{ id: 'ol_variant_1', productId: 'ol_product_1', sku: 'SKU-1' }])
      ),
    };

    lock = {
      acquire: jest.fn(() => Promise.resolve('token-1')),
      release: jest.fn(() => Promise.resolve(true)),
      extend: jest.fn(() => Promise.resolve(true)),
    };

    service = new ReturnCustodyService(
      repository as never,
      returns as never,
      integrations as never,
      products as never,
      lock as never
    );
  });

  describe('receiveLine', () => {
    it('should record a receipt act and move the counters', async () => {
      await service.receiveLine(LINE_ID, { quantity: 3 });

      expect(lastWrite?.event.kind).toBe('receive');
      // A receipt never had a book write to make.
      expect(lastWrite?.event.restockState).toBe('not_applicable');
      expect(lastWrite?.outcome).toMatchObject({ custodyState: 'received', quantityReceived: 3 });
    });

    it('should refuse an over-receipt with the actionable reason rather than a message', async () => {
      lineState = makeLine({ quantityReceived: 4 });

      await expect(service.receiveLine(LINE_ID, { quantity: 3 })).rejects.toMatchObject({
        reason: 'over-receipt',
      });
      expect(repository.settleLineRestock).not.toHaveBeenCalled();
    });

    it('should not gate a receipt on attribution, because a parcel arrived regardless', async () => {
      await service.receiveLine(LINE_ID, { quantity: 1 });

      expect(returns.assertAttributedForTrigger).not.toHaveBeenCalled();
    });

    it('should never take the per-line lock, because it crosses no boundary', async () => {
      await service.receiveLine(LINE_ID, { quantity: 1 });

      expect(lock.acquire).not.toHaveBeenCalled();
    });
  });

  describe('disposeLine — scrap', () => {
    it('should write no stock anywhere and record the act as not applicable', async () => {
      lineState = makeLine({ quantityReceived: 3, custodyState: 'received' });

      const result = await service.disposeLine(LINE_ID, { quantity: 3, disposition: 'scrap' });

      expect(adjustInventory).not.toHaveBeenCalled();
      expect(result.restockBlocked).toBeNull();
      expect(lastWrite?.event.restockState).toBe('not_applicable');
      expect(lastWrite?.outcome).toMatchObject({ quantityScrapped: 3 });
      // Scrap never asks the master, so it never asks for the lock either.
      expect(lock.acquire).not.toHaveBeenCalled();
    });
  });

  describe('disposeLine — restock', () => {
    beforeEach(() => {
      lineState = makeLine({ quantityReceived: 3, custodyState: 'received' });
    });

    it('should assert attribution before writing anything', async () => {
      await service.disposeLine(LINE_ID, { quantity: 2, disposition: 'restock' });

      expect(returns.assertAttributedForTrigger).toHaveBeenCalledWith(RETURN_ID, 'restock');
    });

    it('should refuse an orphan return without touching the master', async () => {
      returns.assertAttributedForTrigger.mockRejectedValueOnce(new Error('orphan'));

      await expect(
        service.disposeLine(LINE_ID, { quantity: 2, disposition: 'restock' })
      ).rejects.toThrow('orphan');
      expect(adjustInventory).not.toHaveBeenCalled();
      expect(lock.acquire).not.toHaveBeenCalled();
    });

    it('should persist the act as in_doubt BEFORE calling the master', async () => {
      // The ADR-056 attempted-predicate ordering: a process dying mid-call must
      // leave a record that stock MAY have moved.
      let stateAtCallTime: unknown;
      adjustInventory.mockImplementationOnce(() => {
        stateAtCallTime = lastWrite?.event.restockState;
        return Promise.reject(new Error('master exploded'));
      });

      const result = await service.disposeLine(LINE_ID, {
        quantity: 2,
        disposition: 'restock',
      });

      expect(stateAtCallTime).toBe('in_doubt');
      expect(result.restockBlocked).not.toBeNull();
    });

    it('should not move the counters at act time, only after the master answers', async () => {
      let outcomeAtCallTime: unknown = 'unset';
      adjustInventory.mockImplementationOnce(() => {
        outcomeAtCallTime = lastWrite?.outcome;
        return Promise.reject(new Error('refused'));
      });

      await service.disposeLine(LINE_ID, { quantity: 2, disposition: 'restock' });

      // The act row exists, but no counter has moved yet.
      expect(outcomeAtCallTime).toBeNull();
    });

    it('should refuse an over-disposition BEFORE crossing the boundary', async () => {
      lineState = makeLine({ quantityReceived: 1, custodyState: 'received' });

      await expect(
        service.disposeLine(LINE_ID, { quantity: 5, disposition: 'restock' })
      ).rejects.toBeInstanceOf(ReturnCustodyTransitionError);
      expect(adjustInventory).not.toHaveBeenCalled();
    });

    it('should move quantityRestocked only when the master took the units', async () => {
      const result = await service.disposeLine(LINE_ID, {
        quantity: 2,
        disposition: 'restock',
      });

      expect(result.restockBlocked).toBeNull();
      expect(settledOutcome).toMatchObject({ quantityRestocked: 2 });
    });

    it('should NOT move quantityRestocked when the master refused', async () => {
      // Spec § 5.4: blocked units stay in `quantityReceived`, never in
      // `quantityRestocked`, and #2381 asserts no surface renders them restocked.
      adjustInventory.mockRejectedValueOnce(new Error('PrestaShop refuses stock writes'));

      const result = await service.disposeLine(LINE_ID, {
        quantity: 2,
        disposition: 'restock',
      });

      const [, , patch] = repository.settleLineRestock.mock.calls[0] as [
        string,
        string,
        { restockState: string },
      ];
      expect(patch.restockState).toBe('blocked');
      // No counter moves on the blocked branch (spec § 5.4).
      expect(settledOutcome).toBeNull();
      expect(result.restockBlocked).toMatchObject({
        quantity: 2,
        sku: 'SKU-1',
        reason: 'master-refused',
        connectionName: 'Main shop',
      });
    });

    it('should compute the counter move from the row as it stands at SETTLE time', async () => {
      // A concurrent `receiveLine` lands during the master call. The outcome
      // must be derived from the row THEN, not from the read taken before it —
      // otherwise the receipt is silently clobbered by a stale absolute count.
      adjustInventory.mockImplementationOnce(() => {
        lineState = makeLine({ quantityReceived: 5, custodyState: 'received' });
        return Promise.resolve({
          id: 'inv-1',
          productId: 'ol_product_1',
          quantity: 7,
          reserved: 0,
          available: 7,
          adjustmentOutcome: {
            disposition: 'applied' as const,
            idempotency: 'honoured' as const,
            appliedAt: null,
          },
        });
      });

      await service.disposeLine(LINE_ID, { quantity: 2, disposition: 'restock' });

      expect(settledOutcome).toMatchObject({ quantityReceived: 5, quantityRestocked: 2 });
    });

    it('should build a deterministic idempotency key from the act sequence', async () => {
      await service.disposeLine(LINE_ID, { quantity: 2, disposition: 'restock' });

      expect(adjustInventory).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `return:${RETURN_ID}:${LINE_ID}:1`,
          reason: 'return_restock',
          quantity: 2,
        })
      );
    });

    it('should serialize the disposal under the per-line lock and always release it', async () => {
      await service.disposeLine(LINE_ID, { quantity: 2, disposition: 'restock' });

      expect(lock.acquire).toHaveBeenCalledWith(`return:line:${LINE_ID}`, expect.any(Number));
      expect(lock.release).toHaveBeenCalledWith(`return:line:${LINE_ID}`, 'token-1');
    });

    it('should refuse a contended disposal without reaching the adapter', async () => {
      lock.acquire.mockResolvedValueOnce(null);

      await expect(
        service.disposeLine(LINE_ID, { quantity: 2, disposition: 'restock' })
      ).rejects.toBeInstanceOf(ReturnCustodyContendedError);
      expect(adjustInventory).not.toHaveBeenCalled();
    });

    it('should block rather than guess when several inventory masters resolve', async () => {
      integrations.listCapabilityAdapters.mockResolvedValueOnce([
        { connectionId: 'a', connection: { id: 'a', name: 'A' }, adapter: {}, metadata: {} },
        { connectionId: 'b', connection: { id: 'b', name: 'B' }, adapter: {}, metadata: {} },
      ]);

      const result = await service.disposeLine(LINE_ID, {
        quantity: 2,
        disposition: 'restock',
      });

      expect(result.restockBlocked?.reason).toBe('ambiguous-inventory-master');
      expect(adjustInventory).not.toHaveBeenCalled();
    });

    it('should report a build failure as adapter-unresolved, never as nothing configured', async () => {
      // Telling an operator they have configured no master, when they have and
      // its credentials merely expired, sends them to fix something that is not
      // broken.
      integrations.listCapabilityAdapters.mockRejectedValueOnce(new Error('credentials expired'));

      const result = await service.disposeLine(LINE_ID, {
        quantity: 2,
        disposition: 'restock',
      });

      expect(result.restockBlocked?.reason).toBe('adapter-unresolved');
    });

    it('should stamp which master refused, so the remediation copy can name it', async () => {
      adjustInventory.mockRejectedValueOnce(new Error('refused'));

      await service.disposeLine(LINE_ID, { quantity: 2, disposition: 'restock' });

      expect(lastWrite?.event.masterConnectionId).toBe('conn-master');
    });

    it('should block when no inventory master is configured at all', async () => {
      integrations.listCapabilityAdapters.mockResolvedValueOnce([]);

      const result = await service.disposeLine(LINE_ID, {
        quantity: 2,
        disposition: 'restock',
      });

      expect(result.restockBlocked?.reason).toBe('no-inventory-master');
    });

    it('should block rather than guess when the sku matches several variants', async () => {
      products.getVariantsBySkus.mockResolvedValueOnce([
        { id: 'v1', productId: 'p1', sku: 'SKU-1' },
        { id: 'v2', productId: 'p2', sku: 'SKU-1' },
      ]);

      const result = await service.disposeLine(LINE_ID, {
        quantity: 2,
        disposition: 'restock',
      });

      expect(result.restockBlocked?.reason).toBe('ambiguous-product');
      expect(adjustInventory).not.toHaveBeenCalled();
    });

    it('should block when the line names a sku OpenLinker has never catalogued', async () => {
      products.getVariantsBySkus.mockResolvedValueOnce([]);

      const result = await service.disposeLine(LINE_ID, {
        quantity: 2,
        disposition: 'restock',
      });

      expect(result.restockBlocked?.reason).toBe('unresolved-product');
    });

    it('should treat a deduplicated master response as a success', async () => {
      adjustInventory.mockResolvedValueOnce({
        id: 'inv-1',
        productId: 'ol_product_1',
        quantity: 7,
        reserved: 0,
        available: 7,
        adjustmentOutcome: {
          disposition: 'deduplicated',
          idempotency: 'honoured',
          appliedAt: null,
        },
      });

      const result = await service.disposeLine(LINE_ID, {
        quantity: 2,
        disposition: 'restock',
      });

      expect(result.restockBlocked).toBeNull();
    });
  });

  describe('markStockHandledManually', () => {
    it('should refuse when there is nothing outstanding to attest to', async () => {
      repository.findOutstandingRestockEvents.mockResolvedValueOnce([]);

      await expect(service.markStockHandledManually(LINE_ID, {})).rejects.toBeInstanceOf(
        ReturnRestockAttestationInvalidError
      );
    });

    it('should move the units into quantityRestocked without ever writing stock', async () => {
      lineState = makeLine({ quantityReceived: 3, custodyState: 'received' });
      repository.findOutstandingRestockEvents.mockResolvedValueOnce([
        makeEvent(1, { id: 'blocked-1', restockState: 'blocked', quantity: 2 }),
      ]);

      const result = await service.markStockHandledManually(LINE_ID, { actorUserId: 'user-9' });

      expect(adjustInventory).not.toHaveBeenCalled();
      expect(result.events).toHaveLength(1);
      expect(lastWrite?.event).toMatchObject({
        kind: 'stock_attestation',
        restockState: 'handled_manually',
        restockedBy: 'operator_out_of_band',
        attestedByEventId: 'blocked-1',
        actorUserId: 'user-9',
      });
      expect(lastWrite?.outcome).toMatchObject({ quantityRestocked: 2 });
    });

    it('should settle the blocked act so it stops being outstanding', async () => {
      lineState = makeLine({ quantityReceived: 3, custodyState: 'received' });
      repository.findOutstandingRestockEvents.mockResolvedValueOnce([
        makeEvent(1, { id: 'blocked-1', restockState: 'blocked', quantity: 2 }),
      ]);

      await service.markStockHandledManually(LINE_ID, {});

      const [eventId, , patch] = repository.settleLineRestock.mock.calls[0] as [
        string,
        string,
        { restockState: string; restockedBy: string },
      ];
      expect(eventId).toBe('blocked-1');
      expect(patch.restockState).toBe('handled_manually');
      expect(patch.restockedBy).toBe('operator_out_of_band');
    });

    it('should also resolve an in_doubt act, whose remediation is the same', async () => {
      lineState = makeLine({ quantityReceived: 3, custodyState: 'received' });
      repository.findOutstandingRestockEvents.mockResolvedValueOnce([
        makeEvent(1, { id: 'doubt-1', restockState: 'in_doubt', quantity: 1 }),
      ]);

      const result = await service.markStockHandledManually(LINE_ID, {});

      expect(result.events).toHaveLength(1);
      expect(adjustInventory).not.toHaveBeenCalled();
    });
  });

  describe('listOutstandingRestockBlocks', () => {
    it('should name the connection that refused rather than reporting null', async () => {
      repository.findOutstandingRestockEventsForReturn.mockResolvedValueOnce([
        makeEvent(1, {
          id: 'blocked-1',
          restockState: 'blocked',
          quantity: 2,
          masterConnectionId: 'conn-master',
        }),
      ]);
      returns.getReturn.mockResolvedValueOnce(makeRecord());
      integrations.getAdapter = jest.fn(() =>
        Promise.resolve({ connection: { id: 'conn-master', name: 'Main shop' }, metadata: {} })
      );

      const [block] = await service.listOutstandingRestockBlocks(RETURN_ID);

      expect(block.connectionId).toBe('conn-master');
      expect(block.connectionName).toBe('Main shop');
    });

    it('should fall back to the connection id when the connection no longer resolves', async () => {
      // An operator can still act on an id; an empty label tells them nothing.
      repository.findOutstandingRestockEventsForReturn.mockResolvedValueOnce([
        makeEvent(1, {
          id: 'blocked-1',
          restockState: 'blocked',
          masterConnectionId: 'conn-gone',
        }),
      ]);
      returns.getReturn.mockResolvedValueOnce(makeRecord());
      integrations.getAdapter = jest.fn(() => Promise.reject(new Error('deleted')));

      const [block] = await service.listOutstandingRestockBlocks(RETURN_ID);

      expect(block.connectionName).toBe('conn-gone');
    });
  });

  describe('markLineNotReturned', () => {
    it('should record the write-off as an act carrying the whole advised quantity', async () => {
      await service.markLineNotReturned(LINE_ID, { actorUserId: 'user-1', note: 'buyer kept it' });

      expect(lastWrite?.event).toMatchObject({
        kind: 'not_returned',
        quantity: 5,
        // Writing a line off changes no stock, so there was never a book write
        // to make — never `blocked`, which would raise a false alarm.
        restockState: 'not_applicable',
        disposition: null,
        actorUserId: 'user-1',
        note: 'buyer kept it',
      });
      expect(lastWrite?.outcome).toMatchObject({ custodyState: 'not_returned' });
    });

    it('should compute the act from the LOCKED row, not from an earlier read', async () => {
      // A receipt landing between an unlocked read and this write is exactly
      // what the rule refuses; the refusal is only reliable if the decision
      // reads the locked state.
      repository.runLineWrite.mockImplementation(
        async (_lineId: string, write: (locked: unknown) => unknown) => {
          const locked = makeLine({ quantityReceived: 2, custodyState: 'received' });
          // Awaited rather than returned, mirroring the real repository: the
          // callback may be async by contract, and the decision is resolved
          // inside the transaction.
          return await write({ line: locked, record: makeRecord() });
        }
      );

      await expect(service.markLineNotReturned(LINE_ID, {})).rejects.toBeInstanceOf(
        ReturnCustodyTransitionError
      );
    });

    it('should refuse a line the source advised no units of', async () => {
      lineState = makeLine({ quantityAdvised: 0 });

      await expect(service.markLineNotReturned(LINE_ID, {})).rejects.toMatchObject({
        reason: 'nothing-advised',
      });
    });

    it('should never cross the inventory-master boundary', async () => {
      await service.markLineNotReturned(LINE_ID, {});

      expect(adjustInventory).not.toHaveBeenCalled();
      expect(integrations.listCapabilityAdapters).not.toHaveBeenCalled();
    });

    it('should not gate on attribution — an orphan parcel still fails to arrive', async () => {
      await service.markLineNotReturned(LINE_ID, {});

      expect(returns.assertAttributedForTrigger).not.toHaveBeenCalled();
    });
  });

  describe('listRestockAttestations (#2381)', () => {
    it('should report the attesting operator and instant, so the terminal state has a source', async () => {
      repository.findAttestationsForReturn = jest.fn(() =>
        Promise.resolve([
          makeEvent(4, {
            id: 'evt-attest',
            kind: 'stock_attestation',
            quantity: 2,
            actorUserId: 'user-7',
            note: 'added by hand',
          }),
        ])
      );

      const [attestation] = await service.listRestockAttestations(RETURN_ID);

      expect(attestation).toMatchObject({
        eventId: 'evt-attest',
        returnLineId: LINE_ID,
        quantity: 2,
        actorUserId: 'user-7',
        note: 'added by hand',
      });
      expect(attestation.occurredAt).toBeInstanceOf(Date);
    });

    it('should be DISJOINT from the outstanding read, which is why both exist', async () => {
      // Attesting FLIPS the act out of ('blocked','in_doubt'), so an attested
      // act leaves the outstanding set entirely. Deriving the terminal state
      // from `listOutstandingRestockBlocks` is therefore impossible, and reading
      // it off the mutation's own result would vanish on reload — #2380's
      // session-state defect one surface down.
      repository.findOutstandingRestockEventsForReturn = jest.fn(() => Promise.resolve([]));
      repository.findAttestationsForReturn = jest.fn(() =>
        Promise.resolve([makeEvent(4, { id: 'evt-attest', kind: 'stock_attestation' })])
      );

      await expect(service.listOutstandingRestockBlocks(RETURN_ID)).resolves.toEqual([]);
      await expect(service.listRestockAttestations(RETURN_ID)).resolves.toHaveLength(1);
    });

    it('should name no connection — the block it answers is gone', async () => {
      repository.findAttestationsForReturn = jest.fn(() =>
        Promise.resolve([makeEvent(4, { id: 'e', kind: 'stock_attestation' })])
      );

      const [attestation] = await service.listRestockAttestations(RETURN_ID);

      // Restating the refusing connection would re-raise an alarm the operator
      // has already answered.
      expect(attestation).not.toHaveProperty('connectionName');
      expect(integrations.listCapabilityAdapters).not.toHaveBeenCalled();
    });
  });

  describe('restock block identity (#2381)', () => {
    it('should carry the LINE, not just the sku — two lines can share one', async () => {
      repository.findOutstandingRestockEventsForReturn = jest.fn(() =>
        Promise.resolve([makeEvent(1, { id: 'evt-b', restockState: 'blocked' })])
      );

      const [block] = await service.listOutstandingRestockBlocks(RETURN_ID);

      expect(block.returnLineId).toBe(LINE_ID);
    });
  });

  describe('getRestockTarget', () => {
    it('should name the connection the dispose write would actually reach', async () => {
      await expect(service.getRestockTarget()).resolves.toEqual({
        status: 'resolved',
        connectionId: 'conn-master',
        connectionName: 'Main shop',
      });
    });

    it('should NOT construct an adapter — a page read must not resolve credentials', async () => {
      await service.getRestockTarget();

      // Building a capability adapter resolves its credentials (#2229), and
      // this read never calls a method on the master. Listing eagerly would
      // build every InventoryMaster connection on every detail page load.
      expect(integrations.listCapabilityAdapters).toHaveBeenCalledWith(
        expect.objectContaining({ capability: 'InventoryMaster', lazy: true })
      );
    });

    it('should report ambiguity rather than the first candidate, matching the write', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([
        { connectionId: 'a', connection: { id: 'a', name: 'One' }, adapter: {}, metadata: {} },
        { connectionId: 'b', connection: { id: 'b', name: 'Two' }, adapter: {}, metadata: {} },
      ]);

      const target = await service.getRestockTarget();

      // Naming "One" here would promise a write `writeMasterStock` is going to
      // refuse — the disclosure has to predict the block, not paper over it.
      expect(target).toEqual({ status: 'ambiguous-inventory-master', candidateCount: 2 });
    });

    it('should distinguish no master at all from one that would not build', async () => {
      integrations.listCapabilityAdapters.mockResolvedValue([]);
      await expect(service.getRestockTarget()).resolves.toEqual({
        status: 'no-inventory-master',
      });

      integrations.listCapabilityAdapters.mockRejectedValue(new Error('credentials'));
      await expect(service.getRestockTarget()).resolves.toEqual({
        status: 'adapter-unresolved',
      });
    });
  });

  describe('no marketplace write originates here', () => {
    it('should only ever resolve the InventoryMaster capability', async () => {
      lineState = makeLine({ quantityReceived: 3, custodyState: 'received' });

      await service.receiveLine(LINE_ID, { quantity: 1 });
      await service.disposeLine(LINE_ID, { quantity: 1, disposition: 'restock' });
      await service.disposeLine(LINE_ID, { quantity: 1, disposition: 'scrap' });

      const capabilities = integrations.listCapabilityAdapters.mock.calls.map(
        ([filters]) => (filters as { capability: string }).capability
      );
      expect(capabilities.every((c) => c === 'InventoryMaster')).toBe(true);
      // The propagation fan-out carries the master adjustment onward; nothing
      // here reaches an OfferManager or a ShopProductManager.
      expect(capabilities).not.toContain('OfferManager');
      expect(capabilities).not.toContain('ProductPublisher');
    });
  });
});
