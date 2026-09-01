/**
 * AutoIssueTriggerService unit tests (OL #1120, #2156, #2173). Mocks
 * `ConnectionPort` + `ISyncJobsService` + `IIntegrationsService` +
 * `IInvoiceService` + `ISalesDocumentRulesService`; asserts cross-capability
 * connection discovery, routing resolution via `resolveSalesDocumentRouting`,
 * the #2173 rule-engine-first precedence with its exact fallback rules,
 * per-kind dispatch (invoice / fiscal-receipt), the deeper
 * `getSupportedDocumentTypes()` capability check, deterministic-key
 * idempotency, plain-object payload (#12), and PII-safe per-connection
 * isolation.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { ModuleRef } from '@nestjs/core';
import {
  AutoIssueTriggerService,
  AUTO_ISSUE_RETRY_BUDGET,
} from './auto-issue-trigger.service';
import { BuyerProfile } from '../../domain/entities/buyer-profile.entity';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { ISyncJobsService } from '@openlinker/core/sync';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { Order } from '@openlinker/core/orders';
import type { IInvoiceService } from './invoice.service.interface';
import { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import type { InvoiceStatus, InvoiceFailureMode } from '../../domain/types/invoicing.types';
import type { ISalesDocumentRulesService, SalesDocumentDecision } from '@openlinker/core/sales-documents';
import { FiscalRegistrationRecord } from '@openlinker/core/fiscalization';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    status: 'processing',
    paymentStatus: 'awaiting',
    // A rated line is the ordinary case now (#2248): the gate refuses a
    // rate-less order before the trigger-model gate is even reached, so an
    // unrated fixture would make every test here exercise the refusal instead
    // of the behaviour it names. The refusal has its own tests below.
    items: [
      { id: 'i1', productId: 'p1', quantity: 2, price: 10, name: 'Widget', taxRate: '23' },
    ],
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

/**
 * `makeOrder()` plus a delivery (shipping) address — the one fact
 * `toSalesDocumentOrderFacts` (#2173) needs to build a non-null order-facts
 * projection at all. Every PRE-#2173 test in this file uses the plain
 * `makeOrder()` (billing address only), which keeps `resolveRouting` from
 * ever being called — this helper is for the new rule-engine-wiring tests
 * that need it to be reachable.
 */
function makeOrderWithDelivery(overrides: Partial<Order> = {}, country = 'PL'): Order {
  return makeOrder({
    shippingAddress: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      address1: 'ul. Testowa 1',
      city: 'Poznań',
      postalCode: '60-001',
      country,
    },
    ...overrides,
  });
}

/**
 * Builds a connection that is a sales-document routing CANDIDATE by default —
 * `config.salesDocument.documentKind` defaults to `'invoice'` and
 * `enabledCapabilities` to `['Invoicing']`, mirroring what an operator must now
 * configure post-#2155/#2156 for the router to consider it at all. Passing a
 * full `config` override skips this default merge, so callers that do so must
 * include `salesDocument.documentKind` themselves if the connection should
 * remain a candidate.
 */
function makeConnection(triggerModel: string | undefined, overrides: Partial<Connection> = {}): Connection {
  const defaultConfig = {
    ...(triggerModel === undefined ? {} : { invoicing: { triggerModel } }),
    salesDocument: { documentKind: 'invoice' },
  };
  return {
    id: overrides.id ?? 'conn-inv-1',
    platformType: 'subiekt',
    name: 'Invoicing conn',
    status: 'active',
    config: overrides.config ?? defaultConfig,
    credentialsRef: 'cred-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    adapterKey: 'subiekt',
    enabledCapabilities: ['Invoicing'],
    ...overrides,
  } as Connection;
}

/** A connection whose only routed kind is `'fiscal-receipt'`. */
function makeFiscalConnection(
  triggerModel: string | undefined,
  overrides: Partial<Connection> = {},
): Connection {
  return makeConnection(triggerModel, {
    id: 'conn-fiscal-1',
    platformType: 'eparagony',
    enabledCapabilities: ['Fiscalization'],
    config: {
      ...(triggerModel === undefined ? {} : { invoicing: { triggerModel } }),
      salesDocument: { documentKind: 'fiscal-receipt' },
    },
    ...overrides,
  });
}

describe('AutoIssueTriggerService', () => {
  let connectionPort: jest.Mocked<Pick<ConnectionPort, 'list' | 'get'>>;
  let syncJobs: jest.Mocked<ISyncJobsService>;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let invoices: jest.Mocked<Pick<IInvoiceService, 'getLatestInvoiceForOrder'>>;
  let salesDocumentRules: jest.Mocked<Pick<ISalesDocumentRulesService, 'resolveRouting'>>;
  let moduleRef: { get: jest.Mock };
  let service: AutoIssueTriggerService;
  let warnSpy: jest.SpyInstance<void, [message: string]>;
  let errorSpy: jest.SpyInstance<void, [message: string]>;

  beforeEach(() => {
    connectionPort = { list: jest.fn(), get: jest.fn() };
    syncJobs = {
      schedule: jest.fn().mockResolvedValue({} as never),
      requeueDeadByIdempotencyKey: jest.fn().mockResolvedValue(false),
      findJobByIdempotencyKey: jest.fn().mockResolvedValue(null),
      requeueStuckJobs: jest.fn().mockResolvedValue(0),
      findLastSucceededJob: jest.fn().mockResolvedValue(null),
      findEnabledPollTask: jest.fn().mockReturnValue(null),
      findEnabledTaskByJobType: jest.fn().mockReturnValue(null),
    };
    // Every invoice-kind test defaults to a fully-supporting Invoicing
    // adapter, so the decision-7 deeper check never spuriously blocks
    // pre-existing scenarios; tests that specifically exercise the check
    // override this mock.
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue({
        getSupportedDocumentTypes: () => ['invoice'],
      }),
    };
    // #2100: the gate reads the order's own invoice projection before reporting a
    // block. Default = no document, so the block paths are reachable; the
    // suppression + read-failure cases override it per test.
    invoices = { getLatestInvoiceForOrder: jest.fn().mockResolvedValue(null) };
    // #2173: default = "no configuration at all for this order's country",
    // which is what makes every PRE-#2173 test in this file exercise the
    // fallback single-primary resolver unchanged. Most of them also build
    // their order via `makeOrder()`, which carries no `shippingAddress` at
    // all, so `toSalesDocumentOrderFacts` returns `null` and this mock is
    // never even called for them — the regression guarantee is structural,
    // not just a default-return-value coincidence.
    salesDocumentRules = {
      resolveRouting: jest
        .fn()
        .mockResolvedValue({ kind: 'unresolved', reason: 'no-configuration-for-country' }),
    };
    // Default: fiscalization is not wired into this process (mirrors
    // `InvoiceService.resolveFiscalRegistrationService`'s own spec default)
    // — the reportBlock cross-kind check (review finding 6) is a no-op
    // unless a test explicitly wires a fiscal-registration-service mock via
    // `moduleRef.get.mockReturnValueOnce(...)`.
    moduleRef = {
      get: jest.fn(() => {
        throw new Error('FiscalizationModule not registered in this process');
      }),
    };
    service = new AutoIssueTriggerService(
      connectionPort as unknown as ConnectionPort,
      syncJobs as unknown as ISyncJobsService,
      integrations as unknown as IIntegrationsService,
      invoices as unknown as IInvoiceService,
      salesDocumentRules as unknown as ISalesDocumentRulesService,
      moduleRef as unknown as ModuleRef,
    );
    // Silence + capture the PII-safe envelope log.
    warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined) as jest.SpyInstance<void, [message: string]>;
    // Routing-unresolved / dispatch-validation refusals log at ERROR (a
    // misconfiguration that silently suppresses issuance), not WARN.
    errorSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: (m: string) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined) as jest.SpyInstance<void, [message: string]>;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('onOrderTransition — trigger-model gating (invoice kind)', () => {
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

    // One connection per case: with two candidates and no primary the router
    // would refuse for an unrelated reason, making the assertion pass without
    // exercising the trigger-model default at all.
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

  describe('cross-capability connection discovery (#2156)', () => {
    it('excludes connections without Invoicing or Fiscalization capability', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'no-cap', enabledCapabilities: ['OrderSource'] }),
      ]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('queries only ACTIVE connections (D8 — active-only)', async () => {
      connectionPort.list.mockResolvedValue([]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(connectionPort.list).toHaveBeenCalledWith({ status: 'active' });
    });

    it('a connection with ONLY Fiscalization enabled is discovered and can win the routing decision', async () => {
      connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      expect(syncJobs.schedule.mock.calls[0][0].jobType).toBe('fiscalization.register');
    });

    it('a connection carrying no config.salesDocument.documentKind is NOT a routing candidate', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'unconfigured', config: { invoicing: { triggerModel: 'auto-on-paid' } } }),
      ]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
      // Zero eligible candidates short-circuits before the resolver — no
      // spurious "ambiguous" error either.
      expect(errorSpy).not.toHaveBeenCalled();
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

  describe('command composition fidelity (invoice)', () => {
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
  });

  describe('shipping-line label wiring (#1562, invoice kind)', () => {
    // Order with a gross shipping cost so the mapper appends a shipping line.
    const paidShippingOrder = (): Order =>
      makeOrder({
        paymentStatus: 'paid',
        items: [
          { id: 'i1', productId: 'p1', quantity: 1, price: 100, name: 'Widget', taxRate: '23' },
        ],
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
          config: {
            invoicing: { triggerModel: 'auto-on-paid', shippingLineName: 'Koszt wysyłki' },
            salesDocument: { documentKind: 'invoice' },
          },
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
          config: {
            invoicing: { triggerModel: 'auto-on-paid', shippingLineName: '   ' },
            salesDocument: { documentKind: 'invoice' },
          },
        }),
      ]);
      await service.onOrderTransition(paidShippingOrder(), 'src-1');
      expect(shippingLineName()).toBe('Shipping');
    });
  });

  describe('fiscal-receipt dispatch (#2156)', () => {
    it('auto-on-paid: paid order enqueues exactly one fiscalization.register job', async () => {
      connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      const input = syncJobs.schedule.mock.calls[0][0];
      expect(input.jobType).toBe('fiscalization.register');
      expect(input.connectionId).toBe('conn-fiscal-1');
    });

    it('manual: enqueues ZERO jobs', async () => {
      connectionPort.list.mockResolvedValue([makeFiscalConnection('manual')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('reports missing-tax-rate instead of enqueueing, when the switch is on (#2252)', async () => {
      // The receipt route runs the same gate as the invoice route, in the same
      // position. Without it the job enqueued and could only fail at the write
      // gate, with no reason persisted for the operator.
      const previous = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      process.env['OL_TAX_RATE_STRICT_ENABLED'] = 'true';
      try {
        connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);

        const outcome = await service.onOrderTransition(
          makeOrder({
            paymentStatus: 'paid',
            items: [{ id: 'i1', productId: 'p1', quantity: 1, price: 10, name: 'Widget' }],
            // Totals kept consistent with the single line, or the compose step
            // fails its own sum check and the outcome is `indeterminate` rather
            // than the block this test is about.
            totals: {
              subtotal: 10,
              tax: 0,
              shipping: 0,
              total: 10,
              currency: 'PLN',
              taxTreatment: 'inclusive',
            },
          }),
          'src-1',
        );

        expect(outcome).toMatchObject({ kind: 'blocked', block: { reason: 'missing-tax-rate' } });
        expect(syncJobs.schedule).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previous;
      }
    });

    it('enqueues a rate-less order with the switch off - the default', async () => {
      const previous = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
      try {
        connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);

        const outcome = await service.onOrderTransition(
          makeOrder({
            paymentStatus: 'paid',
            items: [{ id: 'i1', productId: 'p1', quantity: 1, price: 10, name: 'Widget' }],
            totals: {
              subtotal: 10,
              tax: 0,
              shipping: 0,
              total: 10,
              currency: 'PLN',
              taxTreatment: 'inclusive',
            },
          }),
          'src-1',
        );

        expect(outcome).toEqual({ kind: 'none' });
        expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      } finally {
        if (previous === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previous;
      }
    });

    it('schedules with deterministic idempotencyKey `fiscal:{connId}:{orderId}` threaded twice', async () => {
      connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ id: 'order-Z', paymentStatus: 'paid' }), 'src-1');
      const input = syncJobs.schedule.mock.calls[0][0];
      expect(input.idempotencyKey).toBe('fiscal:conn-fiscal-1:order-Z');
      expect((input.payload as { idempotencyKey: string }).idempotencyKey).toBe(
        'fiscal:conn-fiscal-1:order-Z',
      );
    });

    it('payload carries lines/currency/totalGross composed from the order, no buyer field at all', async () => {
      connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      const payload = syncJobs.schedule.mock.calls[0][0].payload;
      expect(payload.currency).toBe('PLN');
      expect(payload.totalGross).toBe(20);
      expect(Array.isArray(payload.lines)).toBe(true);
      expect('buyer' in payload).toBe(false);
    });

    it("carries the order's tax-rate era into the payload (#2260 review)", async () => {
      // The gate is era-aware; the write gate in `FiscalRegistrationService` is
      // too. The marker has to survive the hop or the two disagree, and the
      // refusal lands with no persisted reason behind it.
      connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);
      await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
        undefined,
        'pre-rollout',
      );
      const payload = syncJobs.schedule.mock.calls[0][0].payload;
      expect(payload.taxRateEra).toBe('pre-rollout');
    });

    it('omits the era from the payload for an ordinary order (#2260 review)', async () => {
      connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      const payload = syncJobs.schedule.mock.calls[0][0].payload;
      expect('taxRateEra' in payload).toBe(false);
    });

    it('enqueues a rate-less PRE-ROLLOUT order with the switch ON (#2260 review)', async () => {
      // Both gates exempt it, so the job is enqueued and the registration goes
      // through exactly as it did before the epic.
      const previous = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      process.env['OL_TAX_RATE_STRICT_ENABLED'] = 'true';
      try {
        connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);

        const outcome = await service.onOrderTransition(
          makeOrder({
            paymentStatus: 'paid',
            items: [{ id: 'i1', productId: 'p1', quantity: 1, price: 10, name: 'Widget' }],
            totals: {
              subtotal: 10,
              tax: 0,
              shipping: 0,
              total: 10,
              currency: 'PLN',
              taxTreatment: 'inclusive',
            },
          }),
          'src-1',
          undefined,
          'pre-rollout',
        );

        expect(outcome).toEqual({ kind: 'none' });
        expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      } finally {
        if (previous === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previous;
      }
    });

    it('does NOT call the Invoicing capability-adapter check for a fiscal-receipt candidate', async () => {
      connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('a net-priced order surfaces UnsupportedFiscalPriceTreatmentError, caught + logged, no enqueue', async () => {
      connectionPort.list.mockResolvedValue([makeFiscalConnection('auto-on-paid')]);
      await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid', totals: { ...makeOrder().totals, taxTreatment: 'exclusive' } }),
        'src-1',
      );
      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain('UnsupportedFiscalPriceTreatmentError');
    });
  });

  describe('decision-7 deeper capability check (invoice kind, #2156)', () => {
    it('skips dispatch when the Invoicing adapter does not list "invoice" as a supported document type', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue({
        getSupportedDocumentTypes: () => ['credit-note'],
      });
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('does not list');
    });

    it('fails closed (skips) when the adapter cannot be resolved at all', async () => {
      integrations.getCapabilityAdapter.mockRejectedValue(new Error('connection disabled'));
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');
      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // #2047/#2155: one sale is one document. The gate resolves EXACTLY ONE
  // (documentKind, connectionId) pair via resolveSalesDocumentRouting instead
  // of fanning out — and across BOTH kinds, since the routing pool is
  // cross-kind (ADR-041 decision 3a: invoice XOR receipt, never both).
  describe('single-connection resolution (#2047/#2155/#2156)', () => {
    function primary(id: string): Connection {
      return makeConnection('auto-on-paid', {
        id,
        config: {
          invoicing: { triggerModel: 'auto-on-paid', isPrimary: true },
          salesDocument: { documentKind: 'invoice' },
        },
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
      expect(logged).toContain('ambiguous-connection-no-primary');
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
      expect(errorSpy.mock.calls[0][0]).toContain('ambiguous-connection-no-primary');
    });

    it('should keep issuing on the lone connection even when it is not marked primary', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid', { id: 'only' })]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      expect(syncJobs.schedule.mock.calls[0][0].connectionId).toBe('only');
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should ignore a non-boolean isPrimary value when resolving the winner', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', {
          id: 'conn-a',
          // The stored jsonb is untrusted: `isPrimary` is documented as a boolean
          // but nothing stops a hand-edited config from holding a string.
          config: {
            invoicing: { triggerModel: 'auto-on-paid', isPrimary: 'yes' },
            salesDocument: { documentKind: 'invoice' },
          } as unknown as Connection['config'],
        }),
        makeConnection('auto-on-paid', { id: 'conn-b' }),
      ]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('ambiguous-connection-no-primary');
    });

    it('an invoice candidate and a fiscal-receipt candidate compete in the SAME cross-kind pool', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'conn-inv' }),
        makeFiscalConnection('auto-on-paid', { id: 'conn-fiscal' }),
      ]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      // Two candidates, neither primary ⇒ unresolved, exactly like two
      // same-kind candidates would be.
      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('ambiguous-connection-no-primary');
    });

    it('should not log an ambiguity error when no connection has Invoicing or Fiscalization', async () => {
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', { id: 'x', enabledCapabilities: [] }),
      ]);

      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    // Selection resolves the winner BEFORE the trigger model is read, so a
    // primary on a `manual` connection turns auto-issue off for the whole
    // install. That is a legitimate operator choice, but it must not be
    // indistinguishable from "the trigger never fired".
    it('should warn once when the chosen winner is manual while sibling candidates exist', async () => {
      const connections = [
        makeConnection('manual', {
          id: 'conn-primary',
          config: {
            invoicing: { triggerModel: 'manual', isPrimary: true },
            salesDocument: { documentKind: 'invoice' },
          },
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
          config: {
            invoicing: { triggerModel: 'auto-on-paid', isPrimary: true },
            salesDocument: { documentKind: 'invoice' },
          },
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

    it('should report missing-tax-rate, and report it INSTEAD of trigger-model-manual', async () => {
      // The ordering is the point (#2248). On a `manual` connection both apply,
      // and they say different things: `trigger-model-manual` means "waiting for
      // a human" and keeps a working CTA, while this one means no human can
      // issue it either. Reporting the weaker reason leaves the operator
      // clicking a button that refuses.
      //
      // The gate only fires where the deployment opted in (#2245 review), so
      // the switch is set here explicitly. The default is covered below.
      const previousStrict = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      process.env['OL_TAX_RATE_STRICT_ENABLED'] = 'true';
      try {
        connectionPort.list.mockResolvedValue([makeConnection('manual')]);

        const outcome = await service.onOrderTransition(
          makeOrder({
            paymentStatus: 'paid',
            items: [{ id: 'i1', productId: 'p1', quantity: 1, price: 10, name: 'Widget' }],
          }),
          'src-1',
        );

        expect(outcome).toMatchObject({ kind: 'blocked', block: { reason: 'missing-tax-rate' } });
        expect(syncJobs.schedule).not.toHaveBeenCalled();
      } finally {
        if (previousStrict === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previousStrict;
      }
    });

    it('should NOT block a rate-less order with no switch set - that is the default', async () => {
      // Coverage is zero on deploy, so the refusal ships off. If this ever goes
      // red, the default flipped and every uninvoiced order on every existing
      // install just became blocked.
      const previousStrict = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
      try {
        connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);

        const outcome = await service.onOrderTransition(
          makeOrder({
            paymentStatus: 'paid',
            items: [{ id: 'i1', productId: 'p1', quantity: 1, price: 10, name: 'Widget' }],
          }),
          'src-1',
        );

        expect(outcome).toEqual({ kind: 'none' });
        expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      } finally {
        if (previousStrict === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previousStrict;
      }
    });

    it("should NOT block on '0' - a zero rate is an answer, not a gap", async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);

      const outcome = await service.onOrderTransition(
        makeOrder({
          paymentStatus: 'paid',
          items: [
            { id: 'i1', productId: 'p1', quantity: 1, price: 10, name: 'Book', taxRate: '0' },
          ],
        }),
        'src-1',
      );

      expect(outcome).toEqual({ kind: 'none' });
      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
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

    it('should SUPPRESS a block when the order already has a blocking fiscal-registration record (review finding 6)', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('manual')]);
      invoices.getLatestInvoiceForOrder.mockResolvedValue(null);
      const fiscalRegistrations = {
        getByOrderId: jest.fn().mockResolvedValue([
          new FiscalRegistrationRecord(
            'freg-1',
            'conn-fiscal',
            'order-1',
            'eparagony',
            'idem-1',
            'registered',
            null,
            null,
            null,
            new Date('2026-08-01T10:00:00Z'),
            null,
            [],
            null,
            null,
            null,
            null,
            new Date('2026-08-01T10:00:00Z'),
            new Date('2026-08-01T10:00:00Z'),
          ),
        ]),
      };
      moduleRef.get.mockReturnValueOnce(fiscalRegistrations);

      const outcome = await service.onOrderTransition(
        makeOrder({ paymentStatus: 'paid' }),
        'src-1',
      );

      // Without checking the fiscal-registration side too, a `manual` connection
      // would keep re-reporting `trigger-model-manual` on an order that already
      // has a registered receipt from a DIFFERENT connection.
      expect(outcome).toEqual({ kind: 'none' });
      expect(fiscalRegistrations.getByOrderId).toHaveBeenCalledWith('order-1');
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

  // #2173: AutoIssueTriggerService now consults the country-agnostic rule
  // engine BEFORE the single-primary resolver, with a precise fallback
  // precedence — these tests exercise that wiring directly (the
  // rule-engine call itself is mocked; the pure evaluator has its own spec).
  describe('rule-engine-first precedence (#2173, ADR-041 decision 5)', () => {
    it('feeds the rule engine order facts built from the DELIVERY address, carrying the buyer tax id when the source asserted one', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      await service.onOrderTransition(
        makeOrderWithDelivery({ paymentStatus: 'paid' }, 'DE'),
        'src-1',
      );

      expect(salesDocumentRules.resolveRouting).toHaveBeenCalledTimes(1);
      const [facts] = salesDocumentRules.resolveRouting.mock.calls[0];
      expect(facts).toMatchObject({
        country: 'DE',
        totalGross: 20,
        currency: 'PLN',
        taxTreatment: 'inclusive',
        buyerHasTaxId: undefined,
      });
    });

    it('does NOT call the rule engine when the order carries no delivery address at all', async () => {
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid')]);
      // Plain makeOrder() carries only a billingAddress.
      await service.onOrderTransition(makeOrder({ paymentStatus: 'paid' }), 'src-1');

      expect(salesDocumentRules.resolveRouting).not.toHaveBeenCalled();
      // Falls back to the operator-configured resolver and still issues.
      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
    });

    it('routes to the rule engine\'s decision, even when the winning connection has no config.salesDocument.documentKind set', async () => {
      // No `salesDocument.documentKind` in config — NOT an operator-configured
      // candidate at all (eligibleCount would be 0 for it), yet the rule
      // engine can still name it directly (e.g. a country default authored
      // via the new rule-engine UI).
      const conn = makeConnection('auto-on-paid', {
        id: 'conn-rule-routed',
        config: { invoicing: { triggerModel: 'auto-on-paid' } },
      });
      connectionPort.list.mockResolvedValue([conn]);
      salesDocumentRules.resolveRouting.mockResolvedValue({
        kind: 'route',
        documentKind: 'invoice',
        connectionId: 'conn-rule-routed',
      } satisfies SalesDocumentDecision);

      await service.onOrderTransition(
        makeOrderWithDelivery({ paymentStatus: 'paid' }),
        'src-1',
      );

      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      expect(syncJobs.schedule.mock.calls[0][0].connectionId).toBe('conn-rule-routed');
      expect(syncJobs.schedule.mock.calls[0][0].jobType).toBe('invoicing.issue');
    });

    it('falls back to the single-primary resolver when the rule engine reports no-configuration-for-country', async () => {
      salesDocumentRules.resolveRouting.mockResolvedValue({
        kind: 'unresolved',
        reason: 'no-configuration-for-country',
      });
      connectionPort.list.mockResolvedValue([makeConnection('auto-on-paid', { id: 'legacy-conn' })]);

      await service.onOrderTransition(
        makeOrderWithDelivery({ paymentStatus: 'paid' }),
        'src-1',
      );

      expect(salesDocumentRules.resolveRouting).toHaveBeenCalledTimes(1);
      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
      expect(syncJobs.schedule.mock.calls[0][0].connectionId).toBe('legacy-conn');
    });

    it('never falls back on a DIFFERENT unresolved reason — surfaces it via SalesDocumentBlockOutcome instead', async () => {
      salesDocumentRules.resolveRouting.mockResolvedValue({
        kind: 'unresolved',
        reason: 'threshold-currency-mismatch',
      });
      // A legacy operator-configured primary exists too — must NOT be consulted.
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', {
          id: 'legacy-primary',
          config: {
            invoicing: { triggerModel: 'auto-on-paid', isPrimary: true },
            salesDocument: { documentKind: 'invoice' },
          },
        }),
      ]);

      const outcome = await service.onOrderTransition(
        makeOrderWithDelivery({ paymentStatus: 'paid' }),
        'src-1',
      );

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        kind: 'blocked',
        block: {
          reason: 'unresolved-routing',
          unresolvedReason: 'threshold-currency-mismatch',
          detail: expect.stringContaining('threshold-currency-mismatch') as unknown as string,
        },
      });
    });

    it('reports `none` (not a block) when the rule engine has nothing AND the operator-configured pool is also empty', async () => {
      salesDocumentRules.resolveRouting.mockResolvedValue({
        kind: 'unresolved',
        reason: 'no-configuration-for-country',
      });
      // No config.salesDocument.documentKind ⇒ zero eligible operator-configured candidates.
      connectionPort.list.mockResolvedValue([
        makeConnection('auto-on-paid', {
          id: 'unconfigured',
          config: { invoicing: { triggerModel: 'auto-on-paid' } },
        }),
      ]);

      const outcome = await service.onOrderTransition(
        makeOrderWithDelivery({ paymentStatus: 'paid' }),
        'src-1',
      );

      expect(syncJobs.schedule).not.toHaveBeenCalled();
      expect(outcome).toEqual({ kind: 'none' });
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  it('is defined', () => {
    expect(AutoIssueTriggerService).toBeDefined();
  });
});
