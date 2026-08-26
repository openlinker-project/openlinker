/**
 * Shipment Dispatch Service unit tests (#835).
 *
 * Mocks the three ports (ShipmentRepositoryPort + IFulfillmentRoutingService +
 * IIntegrationsService → a fake ShippingProviderManager adapter). Covers every
 * branch of the convergence seam: omp_fulfilled (default + configured),
 * ol_managed_carrier happy path, source_brokered identical path, idempotency,
 * generateLabel failure, and the exhaustiveness guard.
 */

import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  FULFILLMENT_PROCESSOR_KIND,
  type FulfillmentProcessorKind,
  type FulfillmentRoutingResolution,
  type IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import { type IOrderRecordService, OrderRecord, type PaymentStatus } from '@openlinker/core/orders';
import type { SyncLockPort } from '@openlinker/core/sync';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import type { ShipmentDispatchInput } from '../types/shipment-dispatch.types';
import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { UndispatchableResolutionException } from '../../domain/exceptions/undispatchable-resolution.exception';
import { OrderNotDispatchablePaymentStatusException } from '../../domain/exceptions/order-not-dispatchable-payment-status.exception';
import { ShippingProviderRejectionException } from '../../domain/exceptions/shipping-provider-rejection.exception';
import { ShipmentDispatchContendedException } from '../../domain/exceptions/shipment-dispatch-contended.exception';
import { Logger } from '@openlinker/shared/logging';

/**
 * Build an OrderRecord whose snapshot carries the given payment status (or none)
 * and, optionally, a marketplace-sourced COD collect amount (#1435).
 */
function makeOrderRecord(
  paymentStatus?: PaymentStatus,
  codToCollect?: { amount: string; currency: string },
): OrderRecord {
  const snapshot: Record<string, unknown> = {};
  if (paymentStatus !== undefined) snapshot.paymentStatus = paymentStatus;
  if (codToCollect !== undefined) snapshot.codToCollect = codToCollect;
  return new OrderRecord(
    'ol_order_1',
    'ol_customer_1',
    SOURCE,
    null,
    snapshot,
    [],
    'ready',
    new Date(),
    new Date(),
  );
}

const SOURCE = 'conn-allegro';
const INPOST = 'conn-inpost';
const PS = 'conn-prestashop';

function makeInput(overrides: Partial<ShipmentDispatchInput> = {}): ShipmentDispatchInput {
  return {
    sourceConnectionId: SOURCE,
    sourceDeliveryMethodId: 'allegro-courier',
    orderId: 'ol_order_1',
    deliveryIntent: 'address',
    recipient: {
      email: 'buyer@example.com',
      phone: '+48500600700',
      address: {
        street: 'Krakowska',
        buildingNumber: '12',
        city: 'Poznań',
        postCode: '60-001',
        countryCode: 'PL',
      },
    },
    parcel: { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1200 },
    ...overrides,
  };
}

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? INPOST,
    overrides.shippingMethod ?? 'kurier',
    overrides.status ?? 'draft',
    overrides.providerShipmentId ?? null,
    overrides.paczkomatId ?? null,
    overrides.trackingNumber ?? null,
    overrides.labelPdfRef ?? null,
    null,
    null,
    null,
    overrides.failedAt ?? null,
    overrides.errorMessage ?? null,
    new Date(),
    new Date(),
    overrides.sourceDeliveryMethodId ?? null,
    overrides.carrier ?? null,
    overrides.deliveryIntent ?? null,
    overrides.providerCode ?? null,
    overrides.waybillRelayedAt ?? null,
  );
}

function resolution(
  overrides: Partial<FulfillmentRoutingResolution> = {},
): FulfillmentRoutingResolution {
  return {
    processorKind: overrides.processorKind ?? FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
    processorConnectionId:
      overrides.processorConnectionId === undefined ? INPOST : overrides.processorConnectionId,
    source: overrides.source ?? 'rule',
    processorAvailable: overrides.processorAvailable ?? true,
  };
}

describe('ShipmentDispatchService', () => {
  let repository: jest.Mocked<ShipmentRepositoryPort>;
  let routing: jest.Mocked<IFulfillmentRoutingService>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let adapter: jest.Mocked<ShippingProviderManagerPort>;
  let orders: jest.Mocked<IOrderRecordService>;
  let dispatchLock: jest.Mocked<SyncLockPort>;
  let service: ShipmentDispatchService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findActiveByOrderId: jest.fn(),
      findByProviderShipmentId: jest.fn(),
      findBranchOneByOrderAndConnection: jest.fn(),
      update: jest.fn(),
      claimWaybillRelay: jest.fn(),
      releaseWaybillRelay: jest.fn(),
    };
    routing = {
      getRules: jest.fn(),
      getCandidateProcessors: jest.fn(),
      replaceRules: jest.fn(),
      resolve: jest.fn(),
      resolveBatch: jest.fn(),
    };
    adapter = {
      generateLabel: jest.fn(),
      getTracking: jest.fn(),
      // Default InPost-like support set; overridden per-test for DPD.
      getSupportedMethods: jest.fn().mockReturnValue(['paczkomat', 'kurier']),
    };
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
      resolveAdapterMetadata: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    };
    orders = {
      persistOrder: jest.fn(),
      persistIncomingSnapshot: jest.fn(),
      updateSyncStatus: jest.fn(),
      getOrderRecord: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      findByIds: jest.fn(),
      updateFulfillmentState: jest.fn(),
      markItemResolutionFailure: jest.fn(),
      getFailedSyncValueSummary: jest.fn(),
      markCancelled: jest.fn(),
      markSalesDocumentBlock: jest.fn(),
      markPacked: jest.fn(),
      clearPacked: jest.fn(),
      recordAmendment: jest.fn(),
      getEarliestOrderDateByConnection: jest.fn(),
      getSalesAndChannelAnalytics: jest.fn(),
      getTopProducts: jest.fn(),
    };
    const fulfillmentProjection = { recompute: jest.fn() };
    // Uncontended by default (#1917): every pre-existing test asserts the
    // dispatch path itself, so the lock must not change their behaviour.
    dispatchLock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    };
    service = new ShipmentDispatchService(
      repository,
      routing,
      integrations,
      orders,
      fulfillmentProjection,
      dispatchLock,
    );
  });

  describe('payment-status dispatch gate (#938)', () => {
    /** Arrange the ol_managed_carrier happy path so a permitted status dispatches. */
    function arrangeHappyPath(): void {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier, processorConnectionId: INPOST }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null);
      repository.create.mockResolvedValue(makeShipment({ status: 'draft' }));
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-1',
        trackingNumber: null,
        labelPdfRef: 'shipx:label:shipx-1',
      });
      repository.update.mockResolvedValue(makeShipment({ status: 'generated', providerShipmentId: 'shipx-1' }));
    }

    it.each(['awaiting', 'refunded'] as const)(
      'should reject dispatch with OrderNotDispatchablePaymentStatusException when payment status is %s',
      async (paymentStatus) => {
        routing.resolve.mockResolvedValue(resolution());
        orders.getOrderRecord.mockResolvedValue(makeOrderRecord(paymentStatus));

        await expect(service.dispatch(makeInput())).rejects.toBeInstanceOf(
          OrderNotDispatchablePaymentStatusException,
        );

        // No shipment work happens once the gate blocks.
        expect(repository.findActiveByOrderId).not.toHaveBeenCalled();
        expect(repository.create).not.toHaveBeenCalled();
        expect(adapter.generateLabel).not.toHaveBeenCalled();
      },
    );

    it.each(['paid', 'cod'] as const)(
      'should permit dispatch when payment status is %s',
      async (paymentStatus) => {
        arrangeHappyPath();
        orders.getOrderRecord.mockResolvedValue(makeOrderRecord(paymentStatus));

        const result = await service.dispatch(makeInput());

        expect(result.kind).toBe('dispatched');
        expect(adapter.generateLabel).toHaveBeenCalled();
      },
    );

    it('should permit dispatch when the order has no payment status (graceful degradation)', async () => {
      arrangeHappyPath();
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord(undefined));

      const result = await service.dispatch(makeInput());

      expect(result.kind).toBe('dispatched');
    });

    it('should permit dispatch when no order record is found', async () => {
      arrangeHappyPath();
      orders.getOrderRecord.mockResolvedValue(null);

      const result = await service.dispatch(makeInput());

      expect(result.kind).toBe('dispatched');
    });

    it('should fail closed (propagate) when the order record read throws', async () => {
      routing.resolve.mockResolvedValue(resolution());
      orders.getOrderRecord.mockRejectedValue(new Error('db down'));

      await expect(service.dispatch(makeInput())).rejects.toThrow('db down');
      expect(adapter.generateLabel).not.toHaveBeenCalled();
    });
  });

  describe('omp_fulfilled (branch-1, no OL label)', () => {
    it('should return omp_fulfilled for the default (null connection)', async () => {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled, processorConnectionId: null, source: 'default' }),
      );

      const result = await service.dispatch(makeInput());

      expect(result).toEqual({ kind: 'omp_fulfilled' });
      expect(repository.findActiveByOrderId).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should return omp_fulfilled for a CONFIGURED omp_fulfilled rule (non-null connection)', async () => {
      // The Q3 catch: a configured omp_fulfilled rule pins a method to a
      // specific OMP and resolves with a non-null connection — but the OMP
      // still ships externally, so no OL label.
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled, processorConnectionId: PS, source: 'rule' }),
      );

      const result = await service.dispatch(makeInput());

      expect(result).toEqual({ kind: 'omp_fulfilled' });
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('label-generating dispatch', () => {
    it('should create a draft shipment, generate the label, and persist generated for ol_managed_carrier', async () => {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier, processorConnectionId: INPOST }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null);
      const draft = makeShipment({ status: 'draft' });
      repository.create.mockResolvedValue(draft);
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-1',
        trackingNumber: null,
        labelPdfRef: 'shipx:label:shipx-1',
      });
      const generated = makeShipment({ status: 'generated', providerShipmentId: 'shipx-1' });
      repository.update.mockResolvedValue(generated);

      const input = makeInput({ deliveryIntent: 'pickup_point', paczkomatId: 'POZ08A' });
      const result = await service.dispatch(input);

      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(INPOST, 'ShippingProviderManager');
      expect(repository.create).toHaveBeenCalledWith({
        orderId: 'ol_order_1',
        connectionId: INPOST,
        // pickup_point intent resolves to InPost's point method via getSupportedMethods (#979).
        shippingMethod: 'paczkomat',
        deliveryIntent: 'pickup_point',
        paczkomatId: 'POZ08A',
        // Persisted for audit (A2) — the source method this shipment routed from.
        sourceDeliveryMethodId: 'allegro-courier',
      });
      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentId: draft.id,
          connectionId: INPOST,
          orderId: 'ol_order_1',
          shippingMethod: 'paczkomat',
          paczkomatId: 'POZ08A',
          // The identity seam resolves the provider delivery-method id from the
          // source method (#833 ADR-012) and threads it to the adapter.
          deliveryMethodId: 'allegro-courier',
          recipient: input.recipient,
          parcel: input.parcel,
        }),
      );
      expect(repository.update).toHaveBeenCalledWith(
        draft.id,
        expect.objectContaining({
          status: 'generated',
          providerShipmentId: 'shipx-1',
          trackingNumber: undefined,
          labelPdfRef: 'shipx:label:shipx-1',
        }),
      );
      expect(result).toEqual({ kind: 'dispatched', shipment: generated });
    });

    /** Shared happy-path routing + repo mocks for the COD gate tests (#1435). */
    function primeCodDispatch(): void {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier, processorConnectionId: INPOST }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null);
      repository.create.mockResolvedValue(makeShipment({ status: 'draft' }));
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'dpd-1',
        trackingNumber: 'dpd-1',
        labelPdfRef: 'dpd-1',
      });
      repository.update.mockResolvedValue(makeShipment({ status: 'generated' }));
    }

    it('should apply the order-sourced COD amount for a cod order, ignoring the caller amount (#1435)', async () => {
      primeCodDispatch();
      orders.getOrderRecord.mockResolvedValue(
        makeOrderRecord('cod', { amount: '510.94', currency: 'PLN' }),
      );

      await service.dispatch(makeInput({ cod: { amount: '1.00', currency: 'PLN' } }));

      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ cod: { amount: '510.94', currency: 'PLN' } }),
      );
    });

    it('should fall back to the caller COD amount for a cod order with no sourced amount (#1435)', async () => {
      primeCodDispatch();
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord('cod'));

      const cod = { amount: '39.99', currency: 'PLN' };
      await service.dispatch(makeInput({ cod }));

      expect(adapter.generateLabel).toHaveBeenCalledWith(expect.objectContaining({ cod }));
    });

    it('should strip caller-supplied COD for an explicitly prepaid (paid) order (#1435)', async () => {
      primeCodDispatch();
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord('paid'));

      await service.dispatch(makeInput({ cod: { amount: '39.99', currency: 'PLN' } }));

      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ cod: undefined }),
      );
    });

    // Regression guard (#1435): non-marketplace sources (PrestaShop / WooCommerce)
    // don't report payment status, so an operator-typed COD (DPD, #966) must pass
    // through when the status is unknown — the gate is a `paid`-only block-list,
    // NOT an allow-list.
    it('should keep caller-supplied COD when there is no order record (#1435)', async () => {
      primeCodDispatch();
      orders.getOrderRecord.mockResolvedValue(null);

      const cod = { amount: '39.99', currency: 'PLN' };
      await service.dispatch(makeInput({ cod }));

      expect(adapter.generateLabel).toHaveBeenCalledWith(expect.objectContaining({ cod }));
    });

    it('should keep caller-supplied COD when the order reports no payment status (DPD/PrestaShop) (#1435)', async () => {
      primeCodDispatch();
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord(undefined));

      const cod = { amount: '39.99', currency: 'PLN' };
      await service.dispatch(makeInput({ cod }));

      expect(adapter.generateLabel).toHaveBeenCalledWith(expect.objectContaining({ cod }));
    });

    it('should forward cod as undefined when the caller omits it', async () => {
      primeCodDispatch();
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-1',
        trackingNumber: null,
        labelPdfRef: 'shipx:label:shipx-1',
      });
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord('cod'));

      await service.dispatch(makeInput());

      expect(adapter.generateLabel).toHaveBeenCalledWith(expect.objectContaining({ cod: undefined }));
    });

    it('should forward the caller-supplied insured value to the adapter unchanged (#1542)', async () => {
      primeCodDispatch();
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord('paid'));

      const insuredValue = { amount: '150.00', currency: 'PLN' };
      await service.dispatch(makeInput({ insuredValue }));

      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ insuredValue }),
      );
    });

    it('should forward insuredValue as undefined when the caller omits it (#1542)', async () => {
      primeCodDispatch();
      orders.getOrderRecord.mockResolvedValue(makeOrderRecord('paid'));

      await service.dispatch(makeInput());

      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ insuredValue: undefined }),
      );
    });

    it('should dispatch source_brokered through the identical path (no rework for #833)', async () => {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.SourceBrokered, processorConnectionId: SOURCE }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null);
      repository.create.mockResolvedValue(makeShipment({ connectionId: SOURCE }));
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'allegro-1',
        trackingNumber: 'TRACK-1',
        labelPdfRef: 'allegro:label:1',
      });
      repository.update.mockResolvedValue(makeShipment({ status: 'generated' }));

      const result = await service.dispatch(makeInput());

      expect(result.kind).toBe('dispatched');
      expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(SOURCE, 'ShippingProviderManager');
      expect(adapter.generateLabel).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'generated', trackingNumber: 'TRACK-1' }),
      );
    });

    it('should be idempotent — return the existing non-terminal shipment without re-dispatching', async () => {
      routing.resolve.mockResolvedValue(resolution());
      const existing = makeShipment({ status: 'generated', providerShipmentId: 'shipx-existing' });
      repository.findActiveByOrderId.mockResolvedValue(existing);

      const result = await service.dispatch(makeInput());

      expect(result).toEqual({ kind: 'dispatched', shipment: existing });
      expect(repository.create).not.toHaveBeenCalled();
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(adapter.generateLabel).not.toHaveBeenCalled();
    });

    it('should reuse a failed branch-one shipment on retry instead of inserting a duplicate', async () => {
      // Regression: a prior dispatch that failed before minting a waybill leaves
      // a terminal `(order, connection)` row with providerShipmentId = NULL. The
      // partial-unique index forbids a second such row, so the retry must reset
      // and reuse it rather than `create()` a duplicate (which threw
      // UQ_shipments_branch_one_per_order_conn and wedged every retry).
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier, processorConnectionId: INPOST }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null);
      const failed = makeShipment({
        id: 'ol_shipment_prior',
        status: 'failed',
        failedAt: new Date(),
        errorMessage: 'previous 401',
      });
      repository.findBranchOneByOrderAndConnection.mockResolvedValue(failed);
      const reset = makeShipment({ id: 'ol_shipment_prior', status: 'draft' });
      const generated = makeShipment({
        id: 'ol_shipment_prior',
        status: 'generated',
        providerShipmentId: 'dpd-1',
      });
      repository.update.mockResolvedValueOnce(reset).mockResolvedValueOnce(generated);
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'dpd-1',
        trackingNumber: 'dpd-1',
        labelPdfRef: 'dpd:label:1',
      });

      const result = await service.dispatch(makeInput({ deliveryIntent: 'address' }));

      // No duplicate INSERT — the prior row is recycled.
      expect(repository.create).not.toHaveBeenCalled();
      // First update resets the failed row back to a clean draft for this attempt.
      expect(repository.update).toHaveBeenNthCalledWith(
        1,
        'ol_shipment_prior',
        expect.objectContaining({
          status: 'draft',
          shippingMethod: 'kurier',
          failedAt: null,
          errorMessage: null,
        }),
      );
      // The label is generated against the reused shipment id.
      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ shipmentId: 'ol_shipment_prior' }),
      );
      expect(result).toEqual({ kind: 'dispatched', shipment: generated });
    });

    it('should persist failed and rethrow when generateLabel rejects', async () => {
      routing.resolve.mockResolvedValue(resolution());
      repository.findActiveByOrderId.mockResolvedValue(null);
      const draft = makeShipment({ status: 'draft' });
      repository.create.mockResolvedValue(draft);
      const boom = new Error('paczkomat unavailable');
      adapter.generateLabel.mockRejectedValue(boom);
      repository.update.mockResolvedValue(makeShipment({ status: 'failed' }));

      await expect(service.dispatch(makeInput())).rejects.toBe(boom);

      expect(repository.update).toHaveBeenCalledWith(
        draft.id,
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'paczkomat unavailable',
          providerCode: null,
        }),
      );
    });

    it('should log the provider rejection code + details, not just the message (#1428)', async () => {
      routing.resolve.mockResolvedValue(resolution());
      repository.findActiveByOrderId.mockResolvedValue(null);
      repository.create.mockResolvedValue(makeShipment({ status: 'draft' }));
      repository.update.mockResolvedValue(makeShipment({ status: 'failed' }));
      const rejection = new ShippingProviderRejectionException(
        'inpost',
        'target_point',
        'validation errors',
        { fieldErrors: { custom_attributes: [{ target_point: ['does_not_exist'] }] } },
      );
      adapter.generateLabel.mockRejectedValue(rejection);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(service.dispatch(makeInput())).rejects.toBe(rejection);

      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('code=target_point');
      expect(logged).toContain('does_not_exist');
      warn.mockRestore();
    });

    it('should persist the structured providerCode on a ShippingProviderRejectionException (#1918)', async () => {
      routing.resolve.mockResolvedValue(resolution());
      repository.findActiveByOrderId.mockResolvedValue(null);
      const draft = makeShipment({ status: 'draft' });
      repository.create.mockResolvedValue(draft);
      repository.update.mockResolvedValue(makeShipment({ status: 'failed' }));
      const rejection = new ShippingProviderRejectionException(
        'inpost',
        'preflight.missing-parcel-template',
        'validation errors',
      );
      adapter.generateLabel.mockRejectedValue(rejection);

      await expect(service.dispatch(makeInput())).rejects.toBe(rejection);

      expect(repository.update).toHaveBeenCalledWith(
        draft.id,
        expect.objectContaining({
          status: 'failed',
          providerCode: 'preflight.missing-parcel-template',
        }),
      );
    });
  });

  describe('delivery-intent resolution (#979)', () => {
    beforeEach(() => {
      routing.resolve.mockResolvedValue(resolution());
      repository.findActiveByOrderId.mockResolvedValue(null);
      repository.create.mockResolvedValue(makeShipment({ status: 'draft' }));
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'prov-1',
        trackingNumber: null,
        labelPdfRef: 'label:1',
      });
      repository.update.mockResolvedValue(makeShipment({ status: 'generated' }));
    });

    it('should resolve pickup_point to the DPD point method (pickup) and persist both', async () => {
      adapter.getSupportedMethods.mockReturnValue(['kurier', 'pickup']);

      await service.dispatch(makeInput({ deliveryIntent: 'pickup_point', paczkomatId: 'PL11033' }));

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ shippingMethod: 'pickup', deliveryIntent: 'pickup_point' }),
      );
      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ shippingMethod: 'pickup' }),
      );
    });

    it('should resolve pickup_point to the InPost point method (paczkomat)', async () => {
      adapter.getSupportedMethods.mockReturnValue(['paczkomat', 'kurier']);

      await service.dispatch(makeInput({ deliveryIntent: 'pickup_point', paczkomatId: 'POZ08A' }));

      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ shippingMethod: 'paczkomat' }),
      );
    });

    it('should resolve address to kurier', async () => {
      adapter.getSupportedMethods.mockReturnValue(['kurier', 'pickup']);

      await service.dispatch(makeInput({ deliveryIntent: 'address' }));

      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ shippingMethod: 'kurier' }),
      );
    });

    it('should fall back to a legacy shippingMethod when deliveryIntent is absent', async () => {
      adapter.getSupportedMethods.mockReturnValue(['kurier', 'pickup']);

      await service.dispatch(makeInput({ deliveryIntent: undefined, shippingMethod: 'pickup' }));

      expect(adapter.generateLabel).toHaveBeenCalledWith(
        expect.objectContaining({ shippingMethod: 'pickup' }),
      );
    });

    it('should throw UndispatchableResolutionException when neither intent nor method is present', async () => {
      await expect(
        service.dispatch(makeInput({ deliveryIntent: undefined })),
      ).rejects.toBeInstanceOf(UndispatchableResolutionException);
      expect(adapter.generateLabel).not.toHaveBeenCalled();
    });

    it('should throw when the resolved carrier cannot fulfil the intent', async () => {
      adapter.getSupportedMethods.mockReturnValue(['kurier']); // courier-only

      await expect(
        service.dispatch(makeInput({ deliveryIntent: 'pickup_point' })),
      ).rejects.toBeInstanceOf(UndispatchableResolutionException);
      expect(adapter.generateLabel).not.toHaveBeenCalled();
    });
  });

  describe('exhaustiveness guard', () => {
    it('should throw for an unknown processor kind', async () => {
      routing.resolve.mockResolvedValue(
        resolution({ processorKind: 'teleporter' as FulfillmentProcessorKind, processorConnectionId: INPOST }),
      );

      await expect(service.dispatch(makeInput())).rejects.toBeInstanceOf(
        UndispatchableResolutionException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });
  // ── #1917 per-order dispatch serialization ─────────────────────────────────

  describe('per-order dispatch lock (#1917)', () => {
    /** Arrange the ol_managed_carrier happy path so a dispatch reaches the carrier. */
    function arrangeCarrierPath(): void {
      routing.resolve.mockResolvedValue(
        resolution({
          processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
          processorConnectionId: INPOST,
        }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null);
      repository.findBranchOneByOrderAndConnection.mockResolvedValue(null);
      repository.create.mockResolvedValue(makeShipment());
      repository.update.mockResolvedValue(makeShipment({ status: 'generated' }));
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-1',
        trackingNumber: '620000000000000000000001',
        labelPdfRef: 'ref-1',
      });
    }

    it('should acquire the lock keyed on the order before dispatching', async () => {
      arrangeCarrierPath();

      await service.dispatch(makeInput());

      expect(dispatchLock.acquire).toHaveBeenCalledWith(
        'shipment:dispatch:ol_order_1',
        expect.any(Number),
      );
    });

    it('should release the lock after a successful dispatch', async () => {
      arrangeCarrierPath();

      await service.dispatch(makeInput());

      expect(dispatchLock.release).toHaveBeenCalledWith('shipment:dispatch:ol_order_1', 'lock-token');
    });

    it('should release the lock when the dispatch throws', async () => {
      arrangeCarrierPath();
      adapter.generateLabel.mockRejectedValue(new Error('carrier down'));

      await expect(service.dispatch(makeInput())).rejects.toThrow('carrier down');

      expect(dispatchLock.release).toHaveBeenCalledWith('shipment:dispatch:ol_order_1', 'lock-token');
    });

    it('should not let a release failure mask the dispatch result', async () => {
      arrangeCarrierPath();
      dispatchLock.release.mockRejectedValue(new Error('redis gone'));

      // A label may already be paid for at this point — surfacing the release
      // error instead of the result would lose it.
      await expect(service.dispatch(makeInput())).resolves.toEqual({
        kind: 'dispatched',
        shipment: expect.objectContaining({ status: 'generated' }),
      });
    });

    it('should return the concurrent dispatch\'s shipment when contended and the peer finished', async () => {
      const winner = makeShipment({
        id: 'ol_shipment_winner',
        status: 'generated',
        providerShipmentId: 'shipx-winner',
      });
      dispatchLock.acquire.mockResolvedValue(null);
      repository.findActiveByOrderId.mockResolvedValue(winner);

      await expect(service.dispatch(makeInput())).resolves.toEqual({
        kind: 'dispatched',
        shipment: winner,
      });
      // The whole point: the loser must not reach the carrier.
      expect(adapter.generateLabel).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should throw contended when the peer has only persisted a draft with no provider id', async () => {
      // The peer persists its draft row BEFORE calling generateLabel, so a row
      // existing is not a label existing. Reporting that draft as `dispatched`
      // would advertise a waybill the operator cannot download; the retryable
      // contended exception is the honest answer.
      dispatchLock.acquire.mockResolvedValue(null);
      repository.findActiveByOrderId.mockResolvedValue(
        makeShipment({ id: 'ol_shipment_inflight', status: 'draft', providerShipmentId: null }),
      );

      await expect(service.dispatch(makeInput())).rejects.toBeInstanceOf(
        ShipmentDispatchContendedException,
      );
      expect(adapter.generateLabel).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should throw contended when the lock is held and no shipment exists yet', async () => {
      dispatchLock.acquire.mockResolvedValue(null);
      repository.findActiveByOrderId.mockResolvedValue(null);

      await expect(service.dispatch(makeInput())).rejects.toBeInstanceOf(
        ShipmentDispatchContendedException,
      );
      expect(adapter.generateLabel).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should not release a lock it never acquired', async () => {
      dispatchLock.acquire.mockResolvedValue(null);
      repository.findActiveByOrderId.mockResolvedValue(null);

      await expect(service.dispatch(makeInput())).rejects.toBeInstanceOf(
        ShipmentDispatchContendedException,
      );
      expect(dispatchLock.release).not.toHaveBeenCalled();
    });
  });

  // ── #1917 lost-carrier-response adoption ───────────────────────────────────

  describe('reference reconciliation on retry (#1917)', () => {
    /**
     * Arrange a RETRY: a prior attempt left a terminal branch-one row with no
     * provider id — the shape a lost `generateLabel` response leaves behind.
     */
    function arrangeRetry(priorOverrides: Partial<Shipment> = {}): Shipment {
      const priorRow = makeShipment({
        id: 'ol_shipment_c7b2',
        status: 'failed',
        errorMessage: 'socket hang up',
        // The prior attempt used exactly the parameters `makeInput()` sends, so
        // adoption is describing the same label the operator is asking for.
        shippingMethod: 'kurier',
        deliveryIntent: 'address',
        sourceDeliveryMethodId: 'allegro-courier',
        ...priorOverrides,
      });
      routing.resolve.mockResolvedValue(
        resolution({
          processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
          processorConnectionId: INPOST,
        }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null); // `failed` is terminal
      repository.findBranchOneByOrderAndConnection.mockResolvedValue(priorRow);
      repository.update.mockImplementation((id, patch) =>
        Promise.resolve(makeShipment({ id, ...patch })),
      );
      return priorRow;
    }

    it('should adopt the carrier shipment instead of creating a second one', async () => {
      arrangeRetry();
      const reconciling = {
        ...adapter,
        findShipmentByReference: jest.fn().mockResolvedValue({
          providerShipmentId: 'shipx-first',
          trackingNumber: '620000000000000000000088',
        }),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(reconciling);

      const result = await service.dispatch(makeInput());

      expect(reconciling.findShipmentByReference).toHaveBeenCalledWith({
        reference: 'ol_shipment_c7b2',
      });
      // No second paid label.
      expect(reconciling.generateLabel).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenLastCalledWith('ol_shipment_c7b2', {
        status: 'generated',
        providerShipmentId: 'shipx-first',
        trackingNumber: '620000000000000000000088',
      });
      expect(result).toEqual({
        kind: 'dispatched',
        shipment: expect.objectContaining({ providerShipmentId: 'shipx-first' }),
      });
    });

    it('should generate a label when the carrier holds nothing under the reference', async () => {
      arrangeRetry();
      const reconciling = {
        ...adapter,
        findShipmentByReference: jest.fn().mockResolvedValue(null),
      };
      reconciling.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-2',
        trackingNumber: null,
        labelPdfRef: 'ref-2',
      });
      integrations.getCapabilityAdapter.mockResolvedValue(reconciling);

      await service.dispatch(makeInput());

      expect(reconciling.generateLabel).toHaveBeenCalled();
    });

    it('should fall through to generateLabel when the lookup throws', async () => {
      arrangeRetry();
      const reconciling = {
        ...adapter,
        findShipmentByReference: jest.fn().mockRejectedValue(new Error('404 not found')),
      };
      reconciling.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-3',
        trackingNumber: null,
        labelPdfRef: 'ref-3',
      });
      integrations.getCapabilityAdapter.mockResolvedValue(reconciling);

      // Non-fatal by design: a reconciler that cannot answer must never block a
      // dispatch the operator explicitly asked for.
      await expect(service.dispatch(makeInput())).resolves.toEqual({
        kind: 'dispatched',
        shipment: expect.anything(),
      });
      expect(reconciling.generateLabel).toHaveBeenCalled();
    });

    it('should not look up when the adapter does not implement the capability', async () => {
      arrangeRetry();
      adapter.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-4',
        trackingNumber: null,
        labelPdfRef: 'ref-4',
      });

      await service.dispatch(makeInput());

      // DPD-shaped adapter: unchanged, pre-#1917 behaviour.
      expect(adapter.generateLabel).toHaveBeenCalled();
    });

    it('should not look up on a first dispatch', async () => {
      routing.resolve.mockResolvedValue(
        resolution({
          processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
          processorConnectionId: INPOST,
        }),
      );
      repository.findActiveByOrderId.mockResolvedValue(null);
      repository.findBranchOneByOrderAndConnection.mockResolvedValue(null); // no prior attempt
      repository.create.mockResolvedValue(makeShipment());
      repository.update.mockResolvedValue(makeShipment({ status: 'generated' }));
      const reconciling = {
        ...adapter,
        findShipmentByReference: jest.fn(),
      };
      reconciling.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-5',
        trackingNumber: null,
        labelPdfRef: 'ref-5',
      });
      integrations.getCapabilityAdapter.mockResolvedValue(reconciling);

      await service.dispatch(makeInput());

      // The reference has never been sent to the carrier, so the lookup is
      // guaranteed-empty and would only add latency.
      expect(reconciling.findShipmentByReference).not.toHaveBeenCalled();
    });

    it('should not adopt when the retry changes the label parameters', async () => {
      // The operator deliberately switched from a courier delivery to a locker.
      // A label minted under the previous parameters is NOT what they asked for,
      // and adopting it would leave the row describing a paczkomat shipment that
      // was actually paid for as a courier one.
      arrangeRetry();
      const reconciling = {
        ...adapter,
        findShipmentByReference: jest.fn(),
      };
      reconciling.generateLabel.mockResolvedValue({
        providerShipmentId: 'shipx-6',
        trackingNumber: null,
        labelPdfRef: 'ref-6',
      });
      integrations.getCapabilityAdapter.mockResolvedValue(reconciling);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await service.dispatch(makeInput({ deliveryIntent: 'pickup_point', paczkomatId: 'POZ08A' }));

      expect(reconciling.findShipmentByReference).not.toHaveBeenCalled();
      expect(reconciling.generateLabel).toHaveBeenCalled();
      // Silent divergence would be undebuggable from the row alone.
      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('shippingMethod');
      expect(logged).toContain('paczkomatId');
      expect(logged).toContain('deliveryIntent');
      warn.mockRestore();
    });

    it('should still adopt when the prior row predates the nullable parameter columns', async () => {
      // A NULL `deliveryIntent` / `sourceDeliveryMethodId` on the prior row means
      // "not recorded" (columns added after the first shipping release), not
      // "different" — the material change would show up in `shippingMethod`.
      arrangeRetry({ deliveryIntent: null, sourceDeliveryMethodId: null });
      const reconciling = {
        ...adapter,
        findShipmentByReference: jest.fn().mockResolvedValue({
          providerShipmentId: 'shipx-legacy',
          trackingNumber: null,
        }),
      };
      integrations.getCapabilityAdapter.mockResolvedValue(reconciling);

      await service.dispatch(makeInput());

      expect(reconciling.findShipmentByReference).toHaveBeenCalled();
      expect(reconciling.generateLabel).not.toHaveBeenCalled();
    });
  });
});
