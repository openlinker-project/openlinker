/**
 * AutoIssueTriggerService unit tests (OL #1120). Mocks `ConnectionPort` +
 * `ISyncJobsService`; asserts trigger-model gating, deterministic-key
 * idempotency, plain-object payload (#12), and PII-safe per-connection
 * isolation.
 *
 * @module libs/core/src/invoicing/application/services
 */
import {
  AutoIssueTriggerService,
  AUTO_ISSUE_RETRY_BUDGET,
} from './auto-issue-trigger.service';
import { BuyerProfile } from '../../domain/entities/buyer-profile.entity';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { ISyncJobsService } from '@openlinker/core/sync';
import type { Order } from '@openlinker/core/orders';
import type { IInvoiceService } from './invoice.service.interface';
import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoiceStatus, InvoiceFailureMode } from '../../domain/types/invoicing.types';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    status: 'processing',
    paymentStatus: 'awaiting',
    items: [{ id: 'i1', productId: 'p1', quantity: 2, price: 10, name: 'Widget' }],
    totals: {
      subtotal: 20,
      tax: 0,
      shipping: 0,
      total: 20,
      currency: 'PLN',
      taxTreatment: 'inclusive',
    },
    billingAddress: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      address1: 'ul. Testowa 1',
      city: 'Poznań',
      postalCode: '60-001',
      country: 'PL',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeConnection(triggerModel: string | undefined, overrides: Partial<Connection> = {}): Connection {
  return {
    id: overrides.id ?? 'conn-inv-1',
    platformType: 'subiekt',
    name: 'Invoicing conn',
    status: 'active',
    config: triggerModel === undefined ? {} : { invoicing: { triggerModel } },
    credentialsRef: 'cred-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    adapterKey: 'subiekt',
    enabledCapabilities: ['Invoicing'],
    ...overrides,
  } as Connection;
}

describe('AutoIssueTriggerService', () => {
  let connectionPort: jest.Mocked<Pick<ConnectionPort, 'list'>>;
  let syncJobs: jest.Mocked<ISyncJobsService>;
  let invoices: jest.Mocked<Pick<IInvoiceService, 'getLatestInvoiceForOrder'>>;
  let service: AutoIssueTriggerService;
  let warnSpy: jest.SpyInstance<void, [message: string]>;
  let errorSpy: jest.SpyInstance<void, [message: string]>;

  beforeEach(() => {
    connectionPort = { list: jest.fn() };
    syncJobs = {
      schedule: jest.fn().mockResolvedValue({} as never),
      requeueDeadByIdempotencyKey: jest.fn().mockResolvedValue(false),
      findLastSucceededJob: jest.fn().mockResolvedValue(null),
      findEnabledPollTask: jest.fn().mockReturnValue(null),
      findEnabledTaskByJobType: jest.fn().mockReturnValue(null),
    };
    // #2100: the gate reads the order's own invoice projection before reporting a
    // block. Default = no document, so the block paths are reachable; the
    // suppression + read-failure cases override it per test.
    invoices = { getLatestInvoiceForOrder: jest.fn().mockResolvedValue(null) };
    service = new AutoIssueTriggerService(
      connectionPort as unknown as ConnectionPort,
      syncJobs as unknown as ISyncJobsService,
      invoices as unknown as IInvoiceService,
    );
    // Silence + capture the PII-safe envelope log.
    warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined) as jest.SpyInstance<void, [message: string]>;
    // #2047: the ambiguous-primary refusal logs at ERROR (it is a
    // misconfiguration that silently suppresses invoicing), not WARN.
    errorSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: (m: string) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined) as jest.SpyInstance<void, [message: string]>;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('onOrderTransition — trigger-model gating', () => {
    it('auto-on-paid: paid order enqueues exactly one invoicing.issue job', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1', 'evt-1');
      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      expect(syncJobs.schedule.mock.calls[0][0].jobType).toBe('invoicing.issue');
    });

    it('auto-on-paid: NON-paid payment statuses (awaiting) do NOT enqueue', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'awaiting' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('auto-on-paid: cod does NOT enqueue (cod ≠ paid)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'cod' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('auto-on-shipped: order.status === shipped enqueues', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-shipped')]);
      await service.onOrderTransition(makeOrder({ status: 'shipped' }), 'src-1');
      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
    });

    it('auto-on-shipped: non-shipped status does NOT enqueue', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-shipped')]);
      await service.onOrderTransition(makeOrder({ status: 'processing' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('auto-on-shipped: non-shipped order warns ONCE per connection (F7/D6 viability log, PII-clean)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-shipped', { id: 'ship-1' })]);

      // Two non-shipped transitions on the same connection.
      await service.onOrderTransition(makeOrder({ status: 'processing' }), 'src-1');
      await service.onOrderTransition(makeOrder({ status: 'processing' }), 'src-1');

      // Warned exactly once (not per poll), and the envelope is PII-clean.
      const viabilityWarns = warnSpy.mock.calls
        .map((c) => c[0])
        .filter((m) => m.includes('has not yet seen'));
      expect(viabilityWarns).toHaveLength(1);
      expect(viabilityWarns[0]).toContain('connectionId=ship-1');
      expect(viabilityWarns[0]).toContain('observedStatus=processing');
      expect(viabilityWarns[0]).not.toContain('Jan Kowalski');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('manual: enqueues ZERO jobs (no-op)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('manual')]);
      await service.onOrderTransition(
        makeOrder({ status: 'shipped', paymentStatus: 'paid' }),
        'src-1',
      );
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('batched: caught + skipped (no enqueue), logged (deferred, never silently ignored)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('batched')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('BatchedTriggerNotImplementedError');
    });

    // One connection per case: with two candidates and no primary the #2047
    // selection would refuse for an unrelated reason, making the assertion pass
    // without exercising the trigger-model default at all.
    it.each([
      ['unset', undefined],
      ['unrecognized', 'nonsense'],
    ])('%s triggerModel defaults to manual (no enqueue)', async (_label, model) => {
      connectionPort.list.mockResolvedValue([
        makeConnection(model, { id: 'c-default' }),
      ]);
      await service.onOrderTransition(
        makeOrder({ status: 'shipped', paymentStatus: 'paid' }),
        'src-1',
      );
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });
  });

  describe('connection discovery', () => {
    it('excludes connections without the Invoicing capability', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'no-cap', enabledCapabilities: ['Orders'] }),
      ]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('queries only ACTIVE connections (D8 — active-only)', async () => {
      connectionPort.list.mockResolvedValue([]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(connectionPort.list).toHaveBeenCalledWith({ status: 'active' });
    });
  });

  describe('idempotency / payload (F4)', () => {
    it('schedules with deterministic idempotencyKey `invoice:{connId}:{orderId}` threaded twice', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid', { id: 'conn-X' })]);
      await service.onOrderTransition(makeOrder({ id: 'order-Z', paymentStatus: 'paid' }), 'src-1');
      const input = syncJobs.schedule.mock.calls[0][0];
      expect(input.idempotencyKey).toBe('invoice:conn-X:order-Z');
      expect((input.payload as { idempotencyKey: string }).idempotencyKey).toBe(
        'invoice:conn-X:order-Z',
      );
    });

    it('scheduled job carries maxAttempts === AUTO_ISSUE_RETRY_BUDGET and a present runAfter Date', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      const input = syncJobs.schedule.mock.calls[0][0];
      expect(input.maxAttempts).toBe(AUTO_ISSUE_RETRY_BUDGET);
      expect(input.runAfter).toBeInstanceOf(Date);
    });
  });

  describe('command composition fidelity', () => {
    it('payload buyer carries the REAL billing name+address (not redacted)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      const buyer = (syncJobs.schedule.mock.calls[0][0].payload as { buyer: { name: string; address: { line1: string } } }).buyer;
      expect(buyer.name).toBe('Jan Kowalski');
      expect(buyer.address.line1).toBe('ul. Testowa 1');
    });

    it('payload buyer is a PLAIN object (no BuyerProfile prototype / isCompany getter) (#12)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      const buyer = (syncJobs.schedule.mock.calls[0][0].payload as { buyer: object }).buyer;
      expect(buyer).not.toBeInstanceOf(BuyerProfile);
      expect((buyer as { isCompany?: unknown }).isCompany).toBeUndefined();
    });

    it('payload buyer carries order.customerEmail (#1797)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid', customerEmail: 'buyer@example.com' }),
        'src-1',
      );
      const buyer = (syncJobs.schedule.mock.calls[0][0].payload as { buyer: { email?: string | null } })
        .buyer;
      expect(buyer.email).toBe('buyer@example.com');
    });

    it('payload buyer.email is null when the order has no customerEmail (#1797)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      const buyer = (syncJobs.schedule.mock.calls[0][0].payload as { buyer: { email?: string | null } })
        .buyer;
      expect(buyer.email).toBeNull();
    });

    it('no buyerTaxId ⇒ buyer type "private" (B2C-only MVP)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      const buyer = (syncJobs.schedule.mock.calls[0][0].payload as { buyer: { type: string; taxId: unknown } }).buyer;
      expect(buyer.type).toBe('private');
      expect(buyer.taxId).toBeNull();
    });

    it('payload carries saleDate from order.placedAt (P_6 seam, #1525)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid', placedAt: new Date('2026-06-19T14:30:00.000Z') }),
        'src-1',
      );
      const payload = syncJobs.schedule.mock.calls[0][0].payload as { saleDate?: string };
      expect(payload.saleDate).toBe('2026-06-19');
    });

    it('payload omits saleDate entirely when the order has no placedAt', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      const payload = syncJobs.schedule.mock.calls[0][0].payload;
      expect('saleDate' in payload).toBe(false);
    });
  });

  describe('shipping-line label wiring (#1562)', () => {
    // Order with a gross shipping cost so the mapper appends a shipping line.
    const paidShippingOrder = (): Order =>
      makeOrder({
        paymentStatus: 'paid',
        items: [{ id: 'i1', productId: 'p1', quantity: 1, price: 100, name: 'Widget' }],
        totals: {
          subtotal: 100,
          tax: 0,
          shipping: 10,
          total: 110,
          currency: 'PLN',
          taxTreatment: 'inclusive',
        },
      });

    const shippingLineName = (): string => {
      const lines = (
        syncJobs.schedule.mock.calls[0][0].payload as { lines: Array<{ name: string }> }
      ).lines;
      return lines[lines.length - 1].name;
    };

    it("threads config.invoicing.shippingLineName into the payload's shipping line", async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', {
          config: { invoicing: { triggerModel: 'auto-on-paid', shippingLineName: 'Koszt wysyłki' } },
        }),
      ]);
      await service.onOrderTransition(paidShippingOrder(), 'src-1');
      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      expect(shippingLineName()).toBe('Koszt wysyłki');
    });

    it('falls back to the neutral default label when no shippingLineName is configured', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(paidShippingOrder(), 'src-1');
      expect(shippingLineName()).toBe('Shipping');
    });

    it('ignores a blank shippingLineName and uses the neutral default', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', {
          config: { invoicing: { triggerModel: 'auto-on-paid', shippingLineName: '   ' } },
        }),
      ]);
      await service.onOrderTransition(paidShippingOrder(), 'src-1');
      expect(shippingLineName()).toBe('Shipping');
    });
  });

  // #2047: one sale is one invoice. The trigger resolves EXACTLY ONE connection
  // instead of fanning out over every Invoicing-capable one.
  describe('single-connection selection (#2047)', () => {
    function primary(id: string): Connection {
      return makeConnection('auto-on-paid', {
        id,
        config: { invoicing: { triggerModel: 'auto-on-paid', isPrimary: true } },
      });
    }

    it('should enqueue zero jobs and log an error when two connections exist and none is primary', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'conn-a' }),
        makeConnection('auto-on-paid', { id: 'conn-b' }),
      ]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1', 'evt-1');

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0][0];
      expect(logged).toContain('no-primary');
      expect(logged).toContain('conn-a');
      expect(logged).toContain('conn-b');
      expect(logged).toContain('order-1');
    });

    it('should enqueue exactly one job on the primary when two connections exist and one is primary', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'conn-a' }),
        primary('conn-b'),
      ]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      expect(syncJobs.schedule.mock.calls[0][0].connectionId).toBe('conn-b');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should enqueue zero jobs and log an error when more than one connection is primary', async () => {
      connectionPort.list.mockResolvedValue([primary('conn-a'), primary('conn-b')]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('multiple-primaries');
    });

    it('should keep issuing on the lone connection even when it is not marked primary', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid', { id: 'only' })]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      expect(syncJobs.schedule.mock.calls[0][0].connectionId).toBe('only');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should ignore a non-boolean isPrimary value when resolving the primary', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', {
          id: 'conn-a',
          // The stored jsonb is untrusted: `isPrimary` is documented as a boolean
          // but nothing stops a hand-edited config from holding a string.
          config: { invoicing: { triggerModel: 'auto-on-paid', isPrimary: 'yes' } } as
            unknown as Connection['config'],
        }),
        makeConnection('auto-on-paid', { id: 'conn-b' }),
      ]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('no-primary');
    });

    it('should not log an ambiguity error when no connection has the Invoicing capability', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'x', enabledCapabilities: [] }),
      ]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    // Selection runs BEFORE the trigger model is read, so a primary on a
    // `manual` connection turns auto-issue off for the whole install. That is a
    // legitimate operator choice, but it must not be indistinguishable from
    // "the trigger never fired".
    it('should warn once when the chosen primary is manual while sibling candidates exist', async () => {
      const connections = [
        makeConnection('manual', {
          id: 'conn-primary',
          config: { invoicing: { triggerModel: 'manual', isPrimary: true } },
        }),
        makeConnection('auto-on-paid', { id: 'conn-sibling' }),
      ];
      connectionPort.list.mockResolvedValue(connections);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      const manualWarnings = warnSpy.mock.calls.filter(([message]) =>
        message.includes('triggerModel=manual'),
      );
      expect(manualWarnings).toHaveLength(1);
      expect(manualWarnings[0][0]).toContain('conn-primary');
    });

    it('should not warn about a manual connection when it is the only candidate', async () => {
      // With one candidate there is no sibling being passed over, so the manual
      // setting is simply the operator invoicing by hand — nothing to diagnose.
      connectionPort.list.mockResolvedValue([makeConnection('manual', { id: 'only' })]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(
        warnSpy.mock.calls.filter(([message]) => message.includes('triggerModel=manual')),
      ).toHaveLength(0);
    });
  });


  describe('reported block outcome (#2100, ADR-041 decision 11)', () => {
    function twoCandidates(): void {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'conn-a' }),
        makeConnection('auto-on-paid', { id: 'conn-b' }),
      ]);
    }

    it('should report the routing-unresolved bridge value with its own reason when no primary singles a connection out', async () => {
      twoCandidates();

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
        'evt-1',
      );

      // ADR-041 §107: ambiguity is a ROUTING-vocabulary fact, so the gate records
      // the bridge value and carries the routing reason alongside it.
      expect(outcome).toEqual({
        kind: 'blocked',
        block: {
          reason: 'unresolved-routing',
          unresolvedReason: 'ambiguous-connection-no-primary',
          detail: '2 invoicing connections, none marked primary',
        },
      });
    });

    it('should distinguish more-than-one-primary from none in the detail', async () => {
      const primaryConn = (id: string): Connection =>
        makeConnection('auto-on-paid', {
          id,
          config: { invoicing: { triggerModel: 'auto-on-paid', isPrimary: true } },
        });
      connectionPort.list.mockResolvedValue([primaryConn('conn-a'), primaryConn('conn-b')]);

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      expect(outcome).toMatchObject({
        block: { detail: '2 invoicing connections, more than one marked primary' },
      });
    });

    it('should report trigger-model-manual', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('manual')]);

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      expect(outcome).toEqual({ kind: 'blocked', block: { reason: 'trigger-model-manual' } });
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('should report trigger-model-batched, keeping the existing PII-safe log', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('batched')]);

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      expect(outcome).toEqual({ kind: 'blocked', block: { reason: 'trigger-model-batched' } });
      // The reason is ADDITIVE (§54) — the log envelope must not have been dropped.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('BatchedTriggerNotImplementedError');
    });

    it('should report `none` when the job is enqueued — this is what clears a stale reason', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      expect(outcome).toEqual({ kind: 'none' });
    });

    it('should report `none` for an unmet auto-on-paid condition — waiting is not blocked', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'awaiting' }),
        'src-1',
      );

      // An unpaid order is early in its lifecycle, not misconfigured. Badging it
      // would put a permanent warning on every order that has not been paid yet.
      expect(outcome).toEqual({ kind: 'none' });
    });

    it('should report `none` for an unmet auto-on-shipped condition', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-shipped')]);

      const outcome = await service.onOrderTransition(
        makeOrder({ status: 'processing' }),
        'src-1',
      );

      expect(outcome).toEqual({ kind: 'none' });
    });

    it('should report `none` when no connection has the Invoicing capability', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { enabledCapabilities: ['OrderSource'] }),
      ]);

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      // Nothing for an operator to unblock ON THIS ORDER — an install that simply
      // does not do invoicing must not badge every order it ingests.
      expect(outcome).toEqual({ kind: 'none' });
      // No document read is needed to answer that, so none is made.
      expect(invoices.getLatestInvoiceForOrder).not.toHaveBeenCalled();
    });

    // A REAL InvoiceRecord, so these exercise the domain's own
    // `blocksIssuanceElsewhere` getter rather than a hand-stubbed boolean that
    // could agree with a wrong implementation.
    const record = (
      status: InvoiceStatus,
      failureMode: InvoiceFailureMode | null = null,
    ): InvoiceRecord =>
      new InvoiceRecord(
        'inv-1',
        'conn-1',
        'order-1',
        'infakt',
        'invoice',
        status,
        null,
        null,
        'not-applicable',
        null,
        null,
        null,
        null,
        null,
        new Date('2026-08-01T10:00:00Z'),
        new Date('2026-08-01T10:00:00Z'),
        failureMode,
      );

    it('should SUPPRESS a block when the order already carries a document', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('manual')]);
      invoices.getLatestInvoiceForOrder.mockResolvedValue(record('issued'));

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      // The decisive case: `manual` is true forever, so without this the gate
      // re-blocked an order the operator had already invoiced by hand — making the
      // aggregate count wrong and the timeline contradict the invoice panel.
      expect(outcome).toEqual({ kind: 'none' });
      expect(invoices.getLatestInvoiceForOrder).toHaveBeenCalledWith('order-1');
    });

    it('should suppress on an in-flight record, not only an issued one', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('manual')]);
      invoices.getLatestInvoiceForOrder.mockResolvedValue(record('pending'));

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      // Issuance is under way and visible on its own terms; re-labelling the order
      // "blocked" adds nothing.
      expect(outcome).toEqual({ kind: 'none' });
    });

    it('should NOT suppress on a terminal REJECTED failure — the config problem is still real', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'conn-a' }),
        makeConnection('auto-on-paid', { id: 'conn-b' }),
      ]);
      invoices.getLatestInvoiceForOrder.mockResolvedValue(record('failed', 'rejected'));

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      // The provider is known to have created nothing, so clearing here would
      // strip the routing block from an order whose only remaining signal is a
      // failure that says nothing about the missing primary that caused it.
      expect(outcome).toMatchObject({
        kind: 'blocked',
        block: { unresolvedReason: 'ambiguous-connection-no-primary' },
      });
    });

    it('should SUPPRESS on an in-doubt failure — a document may exist at the provider', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'conn-a' }),
        makeConnection('auto-on-paid', { id: 'conn-b' }),
      ]);
      invoices.getLatestInvoiceForOrder.mockResolvedValue(record('failed', 'in-doubt'));

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      // The fiscally dangerous direction: `failed` alone does NOT mean "nothing was
      // issued". An `in-doubt` failure means we do not know whether the provider
      // created a document, so recording "no fiscal document was issued" against it
      // is a claim OL cannot support. This is why the check delegates to
      // `blocksIssuanceElsewhere` instead of testing `status !== 'failed'`.
      expect(outcome).toEqual({ kind: 'none' });
    });

    it('should report `indeterminate` when the document read fails — never a clear', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('manual')]);
      invoices.getLatestInvoiceForOrder.mockRejectedValue(new Error('db down'));

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      expect(outcome).toEqual({ kind: 'indeterminate' });
      expect(warnSpy.mock.calls.map((c) => c[0]).join('\n')).toContain(
        'leaving the persisted reason untouched',
      );
    });

    it('should report `indeterminate`, NOT a clear, when composing the payload fails', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      syncJobs.schedule.mockRejectedValueOnce(new Error('redis down'));

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      // Clearing here would erase a reason the operator had just fixed and put
      // nothing in its place: no invoice, no badge, no count, no job row — the
      // exact silent decline ADR-041 §54 forbids.
      expect(outcome).toEqual({ kind: 'indeterminate' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('should keep every reported detail PII-free', async () => {
      twoCandidates();

      const outcome = await service.onOrderTransition(
        makeOrder({
          paymentStatus: 'paid',
          billingAddress: {
            firstName: 'Jan',
            lastName: 'Kowalski',
            address1: 'ul. Testowa 1',
            city: 'Poznań',
            postalCode: '60-001',
            country: 'PL',
          },
        }),
        'src-1',
      );

      // The detail is rendered verbatim to an operator, so buyer fields must never
      // reach it — a count and neutral vocabulary only.
      const detail = outcome.kind === 'blocked' ? (outcome.block.detail ?? '') : '';
      expect(detail).not.toContain('Kowalski');
      expect(detail).not.toContain('Testowa');
      expect(detail).not.toContain('Poznań');
    });
  });

  describe('selected-connection isolation + PII-safe catch (F9/D11)', () => {
    it('a connection whose composition throws InvalidBuyerProfileError is skipped, and nothing escapes', async () => {
      // No address ⇒ InvalidBuyerProfileError from the mapper.
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid', { id: 'bad' })]);
      const badOrder = makeOrder({ paymentStatus: 'paid' });
      const noAddr = { ...badOrder, billingAddress: undefined, shippingAddress: undefined };
      // #2100: the method now RESOLVES to an outcome. `InvalidBuyerProfileError` is
      // deterministic — it will throw identically on every future transition — so
      // the outcome is `indeterminate`, which tells the caller to leave any
      // persisted reason alone rather than erasing it.
      await expect(service.onOrderTransition(noAddr, 'src-1')).resolves.toEqual({
        kind: 'indeterminate',
      });
      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('the catch envelope contains error.name / connectionId / order.id / sourceEventId and NO correlationId key', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid', { id: 'cZ' })]);
      syncJobs.schedule.mockRejectedValue(new Error('transport down'));
      await service.onOrderTransition(makeOrder({ id: 'oZ', paymentStatus: 'paid' }), 'src-1', 'evt-9');
      const logged = warnSpy.mock.calls[0][0];
      expect(logged).toContain('Error');
      expect(logged).toContain('cZ');
      expect(logged).toContain('oZ');
      expect(logged).toContain('evt-9');
      expect(logged).not.toContain('correlationId');
    });

    it('an unexpected error whose message embeds a buyer name does NOT leak into the log (non-allow-listed)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      syncJobs.schedule.mockRejectedValue(new Error('failed for buyer Jan Kowalski'));
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      const logged = warnSpy.mock.calls[0][0];
      expect(logged).not.toContain('Jan Kowalski');
    });

    it('envelope is well-formed when sourceEventId is undefined', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      syncJobs.schedule.mockRejectedValue(new Error('x'));
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(warnSpy.mock.calls[0][0]).toContain('sourceEventId=n/a');
    });
  });

  it('is defined', () => {
    expect(AutoIssueTriggerService).toBeDefined();
  });
});
