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
import { ShipmentDispatchService } from './shipment-dispatch.service';
import type { ShipmentDispatchInput } from '../types/shipment-dispatch.types';
import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { UndispatchableResolutionException } from '../../domain/exceptions/undispatchable-resolution.exception';
import { OrderNotDispatchablePaymentStatusException } from '../../domain/exceptions/order-not-dispatchable-payment-status.exception';
import { ShippingProviderRejectionException } from '../../domain/exceptions/shipping-provider-rejection.exception';
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
      updateFulfillmentState: jest.fn(),
    };
    const fulfillmentProjection = { recompute: jest.fn() };
    service = new ShipmentDispatchService(
      repository,
      routing,
      integrations,
      orders,
      fulfillmentProjection,
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
        expect.objectContaining({ status: 'failed', errorMessage: 'paczkomat unavailable' }),
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
});
