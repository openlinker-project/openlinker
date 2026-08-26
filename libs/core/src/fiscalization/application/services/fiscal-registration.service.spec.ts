/**
 * Fiscal Registration Service - unit tests
 *
 * The subject here is one sentence: **retrying must never produce a second
 * fiscal registration of the same sale.** Every test below is a way that
 * sentence could be broken, so the assertions are mostly about what the service
 * does NOT do - `registerTransaction` not being called is the load-bearing
 * expectation on the resume paths.
 *
 * @module libs/core/src/fiscalization/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { SyncLockPort } from '@openlinker/core/sync';
import type { IInvoiceService } from '@openlinker/core/invoicing';

import {
  FiscalRegistrationService,
  MAX_SUPPORTED_PROVIDER_TIMEOUT_MS,
  REGISTERING_LEASE_MS,
} from './fiscal-registration.service';
import { FiscalRegistrationRecord } from '../../domain/entities/fiscal-registration-record.entity';
import { DuplicateFiscalRegistrationRecordException } from '../../domain/exceptions/duplicate-fiscal-registration-record.exception';
import { FiscalReconcileCheckFailedException } from '../../domain/exceptions/fiscal-reconcile-check-failed.exception';
import { FiscalRegistrationNotInDoubtException } from '../../domain/exceptions/fiscal-registration-not-in-doubt.exception';
import { FiscalRegistrationRecordNotFoundException } from '../../domain/exceptions/fiscal-registration-record-not-found.exception';
import { MissingIdempotencyKeyException } from '../../domain/exceptions/missing-idempotency-key.exception';
import { MissingFiscalTaxRateException } from '../../domain/exceptions/missing-tax-rate.exception';
import { OrderAlreadyRegisteredException } from '../../domain/exceptions/order-already-registered.exception';
import { OrderAlreadyHasInvoiceException } from '../../domain/exceptions/order-already-has-invoice.exception';
import { FiscalRegistrationContendedException } from '../../domain/exceptions/fiscal-registration-contended.exception';
import type { FiscalRegistrationRecordRepositoryPort } from '../../domain/ports/fiscal-registration-record-repository.port';
import type { FiscalizationPort } from '../../domain/ports/fiscalization.port';
import type { FiscalRegistrationLocator } from '../../domain/ports/capabilities/fiscal-registration-locator.capability';
import type {
  FiscalRegistrationFailureMode,
  FiscalRegistrationStatus,
  RegisterTransactionCommand,
} from '../../domain/types/fiscalization.types';

const CONNECTION_ID = 'conn-1';
const ORDER_ID = 'ol_order_1';
const KEY = 'fiscal:conn-1:ol_order_1';
const NOW = new Date('2026-08-14T10:00:00.000Z');

function command(overrides: Partial<RegisterTransactionCommand> = {}): RegisterTransactionCommand {
  return {
    connectionId: CONNECTION_ID,
    orderId: ORDER_ID,
    idempotencyKey: KEY,
    currency: 'PLN',
    // A rated line is the ordinary case now (#2248): `assertEveryLineHasATaxRate`
    // refuses a blank code before the provider is reached, so a blank fixture
    // would make every test in this file exercise the refusal instead of the
    // behaviour it names. The refusal has its own test below.
    lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '23', sku: null }],
    totalGross: 10,
    ...overrides,
  };
}

function record(
  status: FiscalRegistrationStatus,
  overrides: {
    id?: string;
    connectionId?: string;
    idempotencyKey?: string;
    failureMode?: FiscalRegistrationFailureMode | null;
    leaseExpiresAt?: Date | null;
  } = {},
): FiscalRegistrationRecord {
  return new FiscalRegistrationRecord(
    overrides.id ?? 'rec-1',
    overrides.connectionId ?? CONNECTION_ID,
    ORDER_ID,
    '',
    overrides.idempotencyKey ?? KEY,
    status,
    null,
    null,
    null,
    null,
    null,
    null,
    overrides.failureMode ?? null,
    null,
    null,
    overrides.leaseExpiresAt ?? null,
    NOW,
    NOW,
  );
}

describe('FiscalRegistrationService', () => {
  let repo: jest.Mocked<FiscalRegistrationRecordRepositoryPort>;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let adapter: jest.Mocked<FiscalizationPort>;
  let registrationLock: jest.Mocked<SyncLockPort>;
  let invoiceService: jest.Mocked<Pick<IInvoiceService, 'findBlockingInvoiceForOrder'>>;
  let service: FiscalRegistrationService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      // Default: the order holds no record at all, so the
      // at-most-one-originating-registration guard passes. Cases that exercise
      // the guard override it.
      findAllByOrderId: jest.fn().mockResolvedValue([]),
      updateOutcome: jest.fn(),
      claimForRegistration: jest.fn(),
    };
    adapter = { registerTransaction: jest.fn() };
    integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
    };
    // Default: the lock is always free, so tests exercise `registerLocked`
    // unless a case explicitly simulates contention (#2157).
    registrationLock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    };
    // Default: no blocking invoice exists elsewhere, so the cross-kind guard
    // (#2157, ADR-041 §3a/3b) passes. Cases that exercise it override it.
    invoiceService = {
      findBlockingInvoiceForOrder: jest.fn().mockResolvedValue(null),
    };
    service = new FiscalRegistrationService(
      repo,
      integrations as unknown as IIntegrationsService,
      registrationLock,
      invoiceService as unknown as IInvoiceService,
    );
  });

  describe('fiscal-safety invariants pinned by construction', () => {
    it('keeps the lease strictly longer than the supported provider round-trip', () => {
      // If the lease could expire while a call is still in flight, an expired
      // lease would be re-claimed mid-flight and register one sale twice.
      expect(REGISTERING_LEASE_MS).toBeGreaterThan(MAX_SUPPORTED_PROVIDER_TIMEOUT_MS);
    });
  });

  describe('register - the key', () => {
    it('should refuse a blank idempotency key instead of degrading to at-least-once', async () => {
      await expect(service.register(command({ idempotencyKey: '   ' }))).rejects.toThrow(
        MissingIdempotencyKeyException,
      );
      expect(repo.create).not.toHaveBeenCalled();
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    it('should send the adapter the TRIMMED key it persisted, not the raw one', async () => {
      // Otherwise a provider that echoes OL's key back is later queried by
      // `reconcileInDoubt` under a value it never received, and a real
      // registration reads as `not-found`.
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(record('pending'));
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockResolvedValue(record('registered'));
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: null,
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(command({ idempotencyKey: `  ${KEY}  ` }));

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: KEY }),
      );
      expect(adapter.registerTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: KEY }),
      );
    });
  });

  // The interleaving this closes: register order O under the deterministic key,
  // then re-post the same (connection, order) under ANY other key. The read gate
  // is keyed on `(connectionId, idempotencyKey)` and misses; the unique index
  // knows nothing about orders; a second row is inserted, wins its claim, and the
  // provider is called again. That is one sale registered twice, which ADR-042
  // decision 6 treats as a legal event rather than a data-quality issue.
  describe('register - the at-most-one-originating-registration guard', () => {
    beforeEach(() => {
      // No same-key row: every case below reaches the guard.
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(record('pending'));
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockResolvedValue(record('registered'));
    });

    it('should refuse a DIFFERENT key for an order already registered on the SAME connection', async () => {
      repo.findAllByOrderId.mockResolvedValue([
        record('registered', { id: 'rec-first', idempotencyKey: KEY }),
      ]);

      await expect(
        service.register(command({ idempotencyKey: 'retry-1' })),
      ).rejects.toBeInstanceOf(OrderAlreadyRegisteredException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.claimForRegistration).not.toHaveBeenCalled();
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    it('should refuse a second registration on a DIFFERENT connection', async () => {
      repo.findAllByOrderId.mockResolvedValue([
        record('registered', { id: 'rec-first', connectionId: 'conn-other' }),
      ]);

      await expect(service.register(command())).rejects.toBeInstanceOf(
        OrderAlreadyRegisteredException,
      );
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    const blockingShapes: Array<{
      status: FiscalRegistrationStatus;
      failureMode: FiscalRegistrationFailureMode | null;
    }> = [
      { status: 'pending', failureMode: null },
      { status: 'registering', failureMode: null },
      { status: 'registered', failureMode: null },
      { status: 'failed', failureMode: 'in-doubt' },
      // A mode-less `failed` row is indistinguishable from in-doubt and must
      // fall on the safe side.
      { status: 'failed', failureMode: null },
    ];

    for (const shape of blockingShapes) {
      it(`should refuse while an existing record is ${shape.status} (failureMode=${shape.failureMode ?? 'none'})`, async () => {
        repo.findAllByOrderId.mockResolvedValue([
          record(shape.status, {
            id: 'rec-first',
            idempotencyKey: 'other-key',
            failureMode: shape.failureMode,
          }),
        ]);

        await expect(service.register(command())).rejects.toBeInstanceOf(
          OrderAlreadyRegisteredException,
        );
        expect(adapter.registerTransaction).not.toHaveBeenCalled();
      });
    }

    it('should ALLOW a new registration after a terminal rejection elsewhere', async () => {
      // The provider definitely created nothing, so the sale is still unregistered
      // and moving it to another connection/key is fiscally safe.
      repo.findAllByOrderId.mockResolvedValue([
        record('failed', {
          id: 'rec-first',
          connectionId: 'conn-other',
          failureMode: 'rejected',
        }),
      ]);
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-1',
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(command());

      expect(adapter.registerTransaction).toHaveBeenCalledTimes(1);
    });

    it('should carry the blocking record`s identity on the refusal', async () => {
      // The operator has to be able to open the document that blocked them.
      repo.findAllByOrderId.mockResolvedValue([
        record('failed', {
          id: 'rec-first',
          connectionId: 'conn-other',
          failureMode: 'in-doubt',
        }),
      ]);

      await expect(service.register(command())).rejects.toMatchObject({
        orderId: ORDER_ID,
        registeringConnectionId: 'conn-other',
        requestedConnectionId: CONNECTION_ID,
        blockingRecordId: 'rec-first',
        blockingStatus: 'failed',
      });
    });

    it('should NOT run the guard when the SAME key resumes its own record', async () => {
      // Resuming is the per-key lifecycle, not a new originating registration -
      // running the guard there would refuse every legitimate retry.
      const existing = record('failed', { failureMode: 'rejected' });
      repo.findByIdempotencyKey.mockResolvedValue(existing);
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-1',
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(command());

      expect(repo.findAllByOrderId).not.toHaveBeenCalled();
      expect(adapter.registerTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('register - cross-kind sales-document guard (#2157, ADR-041 §3a/3b)', () => {
    beforeEach(() => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.findAllByOrderId.mockResolvedValue([]);
      repo.create.mockResolvedValue(record('pending'));
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockResolvedValue(record('registered'));
    });

    it('should refuse to register when the order already has a blocking invoice on any connection', async () => {
      invoiceService.findBlockingInvoiceForOrder.mockResolvedValue({
        id: 'invoice-1',
        connectionId: 'invoicing-conn-1',
        status: 'issued',
      } as unknown as Awaited<ReturnType<IInvoiceService['findBlockingInvoiceForOrder']>>);

      await expect(service.register(command())).rejects.toBeInstanceOf(
        OrderAlreadyHasInvoiceException,
      );
      expect(repo.create).not.toHaveBeenCalled();
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    it('should name the blocking invoice connection and id on the refusal', async () => {
      invoiceService.findBlockingInvoiceForOrder.mockResolvedValue({
        id: 'invoice-blocking-1',
        connectionId: 'invoicing-conn-1',
        status: 'pending',
      } as unknown as Awaited<ReturnType<IInvoiceService['findBlockingInvoiceForOrder']>>);

      await expect(service.register(command())).rejects.toMatchObject({
        orderId: ORDER_ID,
        invoicingConnectionId: 'invoicing-conn-1',
        requestedConnectionId: CONNECTION_ID,
        blockingInvoiceId: 'invoice-blocking-1',
        blockingStatus: 'pending',
      });
    });

    it('should register normally when no invoice blocks the order', async () => {
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-1',
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(command());

      expect(invoiceService.findBlockingInvoiceForOrder).toHaveBeenCalledWith(ORDER_ID);
      expect(adapter.registerTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('register - per-order lock (#2157, shared with InvoiceService.issueInvoice)', () => {
    beforeEach(() => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.findAllByOrderId.mockResolvedValue([]);
      repo.create.mockResolvedValue(record('pending'));
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockResolvedValue(record('registered'));
    });

    it('should acquire the lock under the SAME key InvoiceService.issueInvoice uses', async () => {
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-1',
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(command());

      expect(registrationLock.acquire).toHaveBeenCalledWith(
        `invoice:issue:${ORDER_ID}`,
        expect.any(Number),
      );
      expect(registrationLock.release).toHaveBeenCalledWith(
        `invoice:issue:${ORDER_ID}`,
        'lock-token',
      );
    });

    it('should refuse with a retryable contended exception when the lock is held and nothing is persisted yet', async () => {
      registrationLock.acquire.mockResolvedValue(null);

      await expect(service.register(command())).rejects.toBeInstanceOf(
        FiscalRegistrationContendedException,
      );
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('should replay an already-registered same-key row when contended', async () => {
      registrationLock.acquire.mockResolvedValue(null);
      const existing = record('registered');
      repo.findByIdempotencyKey.mockResolvedValue(existing);

      await expect(service.register(command())).resolves.toBe(existing);
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    it('should surface a truthful blocking refusal when contended and a peer already persisted its row', async () => {
      registrationLock.acquire.mockResolvedValue(null);
      repo.findAllByOrderId.mockResolvedValue([
        record('registered', { id: 'rec-peer', connectionId: 'conn-other' }),
      ]);

      await expect(service.register(command())).rejects.toBeInstanceOf(
        OrderAlreadyRegisteredException,
      );
    });
  });

  describe('register - the tax-rate gate (#2248)', () => {
    // The gate only refuses where the deployment opted in (#2245 review), so
    // every strict expectation below has to say so. The switch-off arm gets its
    // own block further down - it is the DEFAULT, so leaving it implicit would
    // let a regression flip the default and still read green here.
    const previousStrict = process.env['OL_TAX_RATE_STRICT_ENABLED'];

    beforeEach(() => {
      process.env['OL_TAX_RATE_STRICT_ENABLED'] = 'true';
    });

    afterEach(() => {
      if (previousStrict === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
      else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previousStrict;
    });

    it('refuses a line with no tax rate BEFORE any read, write or provider call', async () => {
      await expect(
        service.register(
          command({
            lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '', sku: null }],
          }),
        ),
      ).rejects.toBeInstanceOf(MissingFiscalTaxRateException);

      // The order of the guard is the point: a refusal must leave no `pending`
      // row behind for a reconcile pass to find, and must not spend the
      // provider round-trip. Both the read gate and the intent write come
      // after it.
      expect(repo.findByIdempotencyKey).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    it("accepts '0' - a zero rate is an answer, not a gap", async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.findAllByOrderId.mockResolvedValue([]);
      repo.create.mockResolvedValue(record('pending'));
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockImplementation((_id, patch) =>
        Promise.resolve(record(patch.status ?? 'registered')),
      );
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-1',
        documentReference: 'd-1',
        signingIdentity: 's-1',
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(
        command({
          lines: [{ name: 'Book', quantity: 1, unitPriceGross: 10, taxRate: '0', sku: null }],
        }),
      );

      expect(adapter.registerTransaction).toHaveBeenCalled();
    });

    it('accepts a PRE-ROLLOUT order with the switch on (#2260 review)', async () => {
      // The gate is era-aware because `AutoIssueTriggerService` is: without
      // this, the gate reported `none` (clearing any persisted reason), the job
      // enqueued, and this write gate refused it with no badge, no count and no
      // filter hit - a silent decline along the era axis.
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.findAllByOrderId.mockResolvedValue([]);
      repo.create.mockResolvedValue(record('pending'));
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockImplementation((_id, patch) =>
        Promise.resolve(record(patch.status ?? 'registered')),
      );
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-1',
        documentReference: 'd-1',
        signingIdentity: 's-1',
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(
        command({
          lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '', sku: null }],
          taxRateEra: 'pre-rollout',
        }),
      );

      expect(adapter.registerTransaction).toHaveBeenCalled();
    });

    it('still refuses an order whose era marker is unrecognised (#2260 review)', async () => {
      await expect(
        service.register(
          command({
            lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '', sku: null }],
            taxRateEra: 'something-else',
          }),
        ),
      ).rejects.toBeInstanceOf(MissingFiscalTaxRateException);
    });

    it('names the first offending line so the operator knows where to look', async () => {
      const promise = service.register(
        command({
          lines: [
            { name: 'Rated', quantity: 1, unitPriceGross: 10, taxRate: '23', sku: null },
            { name: 'Unrated', quantity: 1, unitPriceGross: 10, taxRate: '  ', sku: 'SKU-9' },
          ],
          totalGross: 20,
        }),
      );

      await expect(promise).rejects.toMatchObject({
        lineCount: 1,
        totalLines: 2,
        firstLineName: 'SKU-9',
      });
    });
  });

  describe('register - the tax-rate gate is off by default (#2245 review)', () => {
    // Catalogue coverage is zero on deploy, so the refusal ships switched off.
    // This asserts the DEFAULT with nothing set in the environment: a change
    // that flipped it would turn every rate-less sale into a refused
    // registration on the first deploy.
    it('registers a rate-less sale with no switch set, exactly as before the epic', async () => {
      const previousStrict = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
      try {
        repo.findByIdempotencyKey.mockResolvedValue(null);
        repo.findAllByOrderId.mockResolvedValue([]);
        repo.create.mockResolvedValue(record('pending'));
        repo.claimForRegistration.mockResolvedValue(record('registering'));
        repo.updateOutcome.mockImplementation((_id, patch) =>
          Promise.resolve(record(patch.status ?? 'registered')),
        );
        adapter.registerTransaction.mockResolvedValue({
          providerType: 'provider-a',
          providerReference: 'p-1',
          documentReference: 'd-1',
          signingIdentity: 's-1',
          registeredAt: NOW,
          artefacts: [],
        });

        await service.register(
          command({
            lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 10, taxRate: '', sku: null }],
          }),
        );

        expect(adapter.registerTransaction).toHaveBeenCalled();
      } finally {
        if (previousStrict === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previousStrict;
      }
    });
  });

  describe('register - the happy path', () => {
    beforeEach(() => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(record('pending'));
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockImplementation((_id, patch) =>
        Promise.resolve(record(patch.status ?? 'registered')),
      );
    });

    it('should persist intent BEFORE crossing the provider boundary', async () => {
      const callOrder: string[] = [];
      repo.create.mockImplementation(() => {
        callOrder.push('create');
        return Promise.resolve(record('pending'));
      });
      adapter.registerTransaction.mockImplementation(() => {
        callOrder.push('adapter');
        return Promise.resolve({
          providerType: 'provider-a',
          providerReference: 'p-1',
          documentReference: 'd-1',
          signingIdentity: 's-1',
          registeredAt: NOW,
          artefacts: [],
        });
      });

      await service.register(command());

      // The whole point of the durable row is that a crash mid-call still leaves
      // evidence to reconcile against.
      expect(callOrder).toEqual(['create', 'adapter']);
    });

    it('should treat an EMPTY artefact list as a success', async () => {
      // A pure reporting regime returns identifiers only; reading that as a
      // failure would make the base contract assume there is something to hand
      // the customer (ADR-042 decision 2).
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-1',
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(command());

      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ status: 'registered', artefacts: [] }),
      );
    });

    it('should persist the neutral identity set verbatim, extras included', async () => {
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-1',
        documentReference: 'd-1',
        signingIdentity: 's-1',
        registeredAt: NOW,
        regimeExtras: { someRegimeKey: 'value' },
        artefacts: [
          {
            medium: 'link',
            disposition: 'send',
            content: 'https://example.test/r/1',
            contentType: null,
            label: null,
          },
        ],
      });

      await service.register(command());

      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({
          providerType: 'provider-a',
          providerReference: 'p-1',
          documentReference: 'd-1',
          signingIdentity: 's-1',
          registeredAt: NOW,
          regimeExtras: { someRegimeKey: 'value' },
          leaseExpiresAt: null,
        }),
      );
    });

    it('should release the lease on the success patch', async () => {
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: null,
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(command());

      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ leaseExpiresAt: null }),
      );
    });
  });

  describe('register - resuming an existing same-key record', () => {
    it('should return an already-registered record verbatim, without a second call', async () => {
      const existing = record('registered');
      repo.findByIdempotencyKey.mockResolvedValue(existing);

      await expect(service.register(command())).resolves.toBe(existing);
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
      expect(repo.claimForRegistration).not.toHaveBeenCalled();
    });

    it('should return a record under a LIVE lease without racing a second call', async () => {
      const existing = record('registering', {
        leaseExpiresAt: new Date(Date.now() + 60_000),
      });
      repo.findByIdempotencyKey.mockResolvedValue(existing);

      await expect(service.register(command())).resolves.toBe(existing);
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    it('should NEVER auto-re-attempt an in-doubt failure', async () => {
      // The sale may already be registered; only a provider lookup or an
      // operator may settle it (ADR-042 decision 7).
      const existing = record('failed', { failureMode: 'in-doubt' });
      repo.findByIdempotencyKey.mockResolvedValue(existing);

      await expect(service.register(command())).resolves.toBe(existing);
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
      expect(repo.claimForRegistration).not.toHaveBeenCalled();
    });

    it('should NEVER auto-re-attempt a failed record whose mode is unreadable', async () => {
      const existing = record('failed', { failureMode: null });
      repo.findByIdempotencyKey.mockResolvedValue(existing);

      await expect(service.register(command())).resolves.toBe(existing);
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    it('should re-attempt a terminal rejected failure under the SAME key', async () => {
      // The one outcome where the provider definitely created nothing.
      repo.findByIdempotencyKey.mockResolvedValue(
        record('failed', { failureMode: 'rejected' }),
      );
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockResolvedValue(record('registered'));
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-2',
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(command());

      expect(repo.create).not.toHaveBeenCalled();
      expect(adapter.registerTransaction).toHaveBeenCalledTimes(1);
    });

    it('should re-attempt a pending record with an expired lease', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(
        record('registering', { leaseExpiresAt: new Date(Date.now() - 60_000) }),
      );
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockResolvedValue(record('registered'));
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: 'p-3',
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });

      await service.register(command());

      expect(adapter.registerTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('register - the create race', () => {
    it('should resume the winner when a concurrent same-key call won the unique guard', async () => {
      const winner = record('registered');
      repo.findByIdempotencyKey
        .mockResolvedValueOnce(null) // read gate saw nothing
        .mockResolvedValueOnce(winner); // re-read after the collision
      repo.create.mockRejectedValue(
        new DuplicateFiscalRegistrationRecordException(CONNECTION_ID, KEY),
      );

      await expect(service.register(command())).resolves.toBe(winner);
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    it('should rethrow a create failure that is not the dedup collision', async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockRejectedValue(new Error('connection reset'));

      await expect(service.register(command())).rejects.toThrow('connection reset');
    });
  });

  describe('register - the atomic claim', () => {
    beforeEach(() => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(record('pending'));
    });

    it('should back off WITHOUT calling the provider when the claim is lost', async () => {
      // Without this, two concurrent same-key calls both pass the read gate and
      // both reach the provider - the exact race the unique index alone cannot
      // close.
      const current = record('registering', {
        leaseExpiresAt: new Date(Date.now() + 60_000),
      });
      repo.claimForRegistration.mockResolvedValue(null);
      repo.findById.mockResolvedValue(current);

      await expect(service.register(command())).resolves.toBe(current);
      expect(adapter.registerTransaction).not.toHaveBeenCalled();
    });

    it('should surface not-found when the row vanished between claim and re-read', async () => {
      repo.claimForRegistration.mockResolvedValue(null);
      repo.findById.mockResolvedValue(null);

      await expect(service.register(command())).rejects.toThrow(
        FiscalRegistrationRecordNotFoundException,
      );
    });

    it('should resolve the adapter BEFORE claiming', async () => {
      // Claiming first parks the row `registering` under a live 5-minute lease
      // with no failureMode whenever adapter resolution throws - the single most
      // likely first-run fault, a connection without the capability enabled.
      // Retries inside that window then report an attempt in progress for a call
      // that was never made.
      const callOrder: string[] = [];
      repo.claimForRegistration.mockImplementation(() => {
        callOrder.push('claim');
        return Promise.resolve(record('registering'));
      });
      integrations.getCapabilityAdapter.mockImplementation(() => {
        callOrder.push('resolve');
        return Promise.resolve(adapter);
      });
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: null,
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });
      repo.updateOutcome.mockResolvedValue(record('registered'));

      await service.register(command());

      expect(callOrder).toEqual(['resolve', 'claim']);
    });

    it('should leave the record UNCLAIMED when the capability is not enabled', async () => {
      integrations.getCapabilityAdapter.mockRejectedValue(
        new Error('Connection conn-1 does not support capability: Fiscalization'),
      );

      await expect(service.register(command())).rejects.toThrow(
        'does not support capability',
      );
      // No claim, no lease, no half-written outcome: the row stays `pending` and
      // freely re-attemptable once the operator enables the capability.
      expect(repo.claimForRegistration).not.toHaveBeenCalled();
      expect(repo.updateOutcome).not.toHaveBeenCalled();
    });

    it('should resolve the adapter under the closed `Fiscalization` capability', async () => {
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      adapter.registerTransaction.mockResolvedValue({
        providerType: 'provider-a',
        providerReference: null,
        documentReference: null,
        signingIdentity: null,
        registeredAt: NOW,
        artefacts: [],
      });
      repo.updateOutcome.mockResolvedValue(record('registered'));

      await service.register(command());

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'Fiscalization',
      );
    });
  });

  describe('register - failure handling', () => {
    beforeEach(() => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      repo.create.mockResolvedValue(record('pending'));
      repo.claimForRegistration.mockResolvedValue(record('registering'));
      repo.updateOutcome.mockImplementation((_id, patch) =>
        Promise.resolve(
          record('failed', { failureMode: patch.failureMode ?? null }),
        ),
      );
    });

    it('should classify an unreadable failure as in-doubt (the fiscal-safe default)', async () => {
      adapter.registerTransaction.mockRejectedValue(new Error('socket hang up'));

      const result = await service.register(command());

      expect(result.failureMode).toBe('in-doubt');
      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ status: 'failed', failureMode: 'in-doubt' }),
      );
    });

    it('should read a terminal rejection structurally off the throwable', async () => {
      // Core never value-imports an adapter error class; the neutral mode is
      // duck-typed off whatever the adapter threw.
      const rejection = Object.assign(new Error('bad line'), {
        failureMode: 'rejected',
        reason: 'Line 1 is missing a tax rate',
      });
      adapter.registerTransaction.mockRejectedValue(rejection);

      const result = await service.register(command());

      expect(result.failureMode).toBe('rejected');
      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({
          failureMode: 'rejected',
          failureReason: 'Line 1 is missing a tax rate',
        }),
      );
    });

    it('should NOT delete the row on a failure - the row IS the in-doubt evidence', async () => {
      // ADR-005's delete-on-publish-failure step is deliberately not adopted:
      // deleting on a throw is the blind-resend path.
      adapter.registerTransaction.mockRejectedValue(new Error('timeout'));

      await service.register(command());

      expect(repo.updateOutcome).toHaveBeenCalledTimes(1);
    });

    it('should release the lease so the row is not stuck in flight forever', async () => {
      adapter.registerTransaction.mockRejectedValue(new Error('timeout'));

      await service.register(command());

      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ leaseExpiresAt: null }),
      );
    });

    it('should return the failed record rather than throwing', async () => {
      // An indeterminate outcome must be VISIBLY indeterminate, and the caller
      // needs the record id to reconcile against.
      adapter.registerTransaction.mockRejectedValue(new Error('timeout'));

      await expect(service.register(command())).resolves.toMatchObject({
        status: 'failed',
        failureMode: 'in-doubt',
      });
    });

    it('should bound the provider call at the supported ceiling and call it in-doubt', async () => {
      // Without a core-side bound the constant above is a promise nothing keeps:
      // an adapter hanging past REGISTERING_LEASE_MS lets a retry re-claim
      // through the expired-lease disjunct and register the same sale twice.
      // Racing does not CANCEL the call, so the timeout must classify as
      // `in-doubt` (never `rejected`) - an in-doubt row is not claimable, which
      // is what actually closes the race.
      jest.useFakeTimers();
      try {
        adapter.registerTransaction.mockImplementation(
          () => new Promise(() => undefined),
        );

        const pending = service.register(command());
        await jest.advanceTimersByTimeAsync(MAX_SUPPORTED_PROVIDER_TIMEOUT_MS + 1);
        const result = await pending;

        expect(result.failureMode).toBe('in-doubt');
        expect(repo.updateOutcome).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            status: 'failed',
            failureMode: 'in-doubt',
            leaseExpiresAt: null,
          }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should NOT time out a provider that answers inside the ceiling', async () => {
      jest.useFakeTimers();
      try {
        adapter.registerTransaction.mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    providerType: 'provider-a',
                    providerReference: 'p-1',
                    documentReference: null,
                    signingIdentity: null,
                    registeredAt: NOW,
                    artefacts: [],
                  }),
                MAX_SUPPORTED_PROVIDER_TIMEOUT_MS - 1_000,
              ),
            ),
        );
        repo.updateOutcome.mockResolvedValue(record('registered'));

        const pending = service.register(command());
        await jest.advanceTimersByTimeAsync(MAX_SUPPORTED_PROVIDER_TIMEOUT_MS);
        await pending;

        expect(repo.updateOutcome).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({ status: 'registered' }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should bound the internal diagnostic it persists', async () => {
      adapter.registerTransaction.mockRejectedValue(new Error('x'.repeat(2000)));

      await service.register(command());

      const patch = repo.updateOutcome.mock.calls[0]?.[1];
      expect(patch?.errorMessage?.length).toBeLessThanOrEqual(500);
    });
  });

  describe('reconcileInDoubt', () => {
    it('should refuse a record that is not an in-doubt failure', async () => {
      repo.findById.mockResolvedValue(record('registered'));

      await expect(service.reconcileInDoubt('rec-1')).rejects.toThrow(
        FiscalRegistrationNotInDoubtException,
      );
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should report `unsupported` for a provider that cannot be queried', async () => {
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));

      const result = await service.reconcileInDoubt('rec-1');

      expect(result.outcome).toBe('unsupported');
      expect(repo.updateOutcome).not.toHaveBeenCalled();
    });

    it('should advance the record when the provider confirms a registration', async () => {
      const locating: FiscalizationPort & FiscalRegistrationLocator = {
        registerTransaction: jest.fn(),
        locateByQuery: jest.fn().mockResolvedValue({
          status: 'registered',
          registration: {
            providerReference: 'p-9',
            documentReference: 'd-9',
            signingIdentity: 's-9',
            registeredAt: NOW,
          },
        }),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(locating);
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));
      repo.updateOutcome.mockResolvedValue(record('registered'));

      const result = await service.reconcileInDoubt('rec-1');

      expect(result.outcome).toBe('resolved');
      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({
          status: 'registered',
          providerReference: 'p-9',
          documentReference: 'd-9',
          signingIdentity: 's-9',
          failureMode: null,
        }),
      );
    });

    it('should backfill the provider identity a locator reports', async () => {
      // Otherwise a record that reaches `registered` by RECONCILIATION keeps the
      // `''` its pending row was created with, and the operator surface labels it
      // "Provider identity: (blank)".
      integrations.getCapabilityAdapter.mockResolvedValue({
        registerTransaction: jest.fn(),
        locateByQuery: jest.fn().mockResolvedValue({
          status: 'registered',
          registration: {
            providerType: 'provider-a',
            providerReference: 'p-9',
            documentReference: null,
            signingIdentity: null,
            registeredAt: NOW,
          },
        }),
      });
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));
      repo.updateOutcome.mockResolvedValue(record('registered'));

      await service.reconcileInDoubt('rec-1');

      expect(repo.updateOutcome).toHaveBeenCalledWith(
        'rec-1',
        expect.objectContaining({ providerType: 'provider-a' }),
      );
    });

    it('should NOT invent a provider identity when the locator reports none', async () => {
      // An omitted key must never be read as "set to null"/"set to blank": core
      // leaves whatever the record holds rather than asserting an identity.
      integrations.getCapabilityAdapter.mockResolvedValue({
        registerTransaction: jest.fn(),
        locateByQuery: jest.fn().mockResolvedValue({
          providerReference: 'p-9',
          documentReference: null,
          signingIdentity: null,
          registeredAt: NOW,
        }),
      });
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));
      repo.updateOutcome.mockResolvedValue(record('registered'));

      await service.reconcileInDoubt('rec-1');

      const patch = repo.updateOutcome.mock.calls[0]?.[1];
      expect(patch && 'providerType' in patch).toBe(false);
    });

    it('should leave the record in doubt when the provider holds no match', async () => {
      // A `null` is evidence, not authority to resend: nothing is re-sent from
      // here, and the record stays for an operator decision.
      const locating: FiscalizationPort & FiscalRegistrationLocator = {
        registerTransaction: jest.fn(),
        locateByQuery: jest.fn().mockResolvedValue(null),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(locating);
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));

      const result = await service.reconcileInDoubt('rec-1');

      expect(result.outcome).toBe('not-found');
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(locating.registerTransaction).not.toHaveBeenCalled();
    });

    it('should report `still-unknown` and touch nothing when the provider HOLDS the sale', async () => {
      // ADR-042 amendment #2502, decisions 1 and 3: a provider that has accepted
      // the sale and not registered it yet is neither an absence nor a failure.
      // The record is left byte-identical and the check can be repeated later.
      const inDoubt = record('failed', { failureMode: 'in-doubt' });
      const locating: FiscalizationPort & FiscalRegistrationLocator = {
        registerTransaction: jest.fn(),
        locateByQuery: jest.fn().mockResolvedValue({ status: 'held', detail: 'PENDING' }),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(locating);
      repo.findById.mockResolvedValue(inDoubt);

      const result = await service.reconcileInDoubt('rec-1');

      expect(result.outcome).toBe('still-unknown');
      expect(result.record).toBe(inDoubt);
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(locating.registerTransaction).not.toHaveBeenCalled();
    });

    it('should report `still-unknown` rather than resolving on an answer it cannot interpret', async () => {
      // A locate status this build does not recognise must never terminalise a
      // record on a registration it cannot confirm.
      integrations.getCapabilityAdapter.mockResolvedValue({
        registerTransaction: jest.fn(),
        locateByQuery: jest.fn().mockResolvedValue({ status: 'something-new' }),
      });
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));

      const result = await service.reconcileInDoubt('rec-1');

      expect(result.outcome).toBe('still-unknown');
      expect(repo.updateOutcome).not.toHaveBeenCalled();
    });

    it('should still resolve a locator that answers in the pre-#2502 shape', async () => {
      // An out-of-tree adapter compiled against an older `libs/core` returns a
      // bare result; reading `.status` off it must not throw on a reconcile.
      integrations.getCapabilityAdapter.mockResolvedValue({
        registerTransaction: jest.fn(),
        locateByQuery: jest.fn().mockResolvedValue({
          providerReference: 'p-9',
          documentReference: null,
          signingIdentity: null,
          registeredAt: NOW,
        }),
      });
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));
      repo.updateOutcome.mockResolvedValue(record('registered'));

      const result = await service.reconcileInDoubt('rec-1');

      expect(result.outcome).toBe('resolved');
    });

    it('should look up by OL`s own business coordinates', async () => {
      const locateByQuery = jest.fn().mockResolvedValue(null);
      integrations.getCapabilityAdapter.mockResolvedValue({
        registerTransaction: jest.fn(),
        locateByQuery,
      });
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));

      await service.reconcileInDoubt('rec-1');

      expect(locateByQuery).toHaveBeenCalledWith({
        idempotencyKey: KEY,
        orderId: ORDER_ID,
      });
    });

    it('should raise a distinct failure when the provider could not be ASKED', async () => {
      // #2522: a throw is not an answer. Reporting it as `unsupported` would
      // state a structural fact about the adapter where the truth is a
      // transient one about the network, and reporting it as `not-found` would
      // assert an absence the provider never asserted.
      const locating: FiscalizationPort & FiscalRegistrationLocator = {
        registerTransaction: jest.fn(),
        locateByQuery: jest.fn().mockRejectedValue(new Error('socket hang up')),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(locating);
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));

      await expect(service.reconcileInDoubt('rec-1')).rejects.toBeInstanceOf(
        FiscalReconcileCheckFailedException,
      );
      expect(repo.updateOutcome).not.toHaveBeenCalled();
      expect(locating.registerTransaction).not.toHaveBeenCalled();
    });

    it('should NOT wrap an adapter-resolution failure as a failed check', async () => {
      // Resolving the adapter is a connection-CONFIGURATION fault, not a
      // provider one; it keeps propagating so the global filter classifies it
      // as itself instead of reading as "the provider could not be reached".
      const configFault = new Error('Connection conn-1 does not support Fiscalization');
      integrations.getCapabilityAdapter.mockRejectedValue(configFault);
      repo.findById.mockResolvedValue(record('failed', { failureMode: 'in-doubt' }));

      await expect(service.reconcileInDoubt('rec-1')).rejects.toBe(configFault);
      expect(repo.updateOutcome).not.toHaveBeenCalled();
    });

    it('should throw not-found for an unknown record id', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.reconcileInDoubt('nope')).rejects.toThrow(
        FiscalRegistrationRecordNotFoundException,
      );
    });
  });

  describe('reads', () => {
    it('should return every record an order holds', async () => {
      const rows = [record('registered'), record('failed', { id: 'rec-2' })];
      repo.findAllByOrderId.mockResolvedValue(rows);

      await expect(service.getByOrderId(ORDER_ID)).resolves.toBe(rows);
    });

    it('should throw not-found rather than return null from getById', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getById('nope')).rejects.toThrow(
        FiscalRegistrationRecordNotFoundException,
      );
    });
  });
});
