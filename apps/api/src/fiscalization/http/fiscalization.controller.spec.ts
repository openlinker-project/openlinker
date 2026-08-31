/**
 * FiscalizationController unit tests (#1908)
 *
 * Covers the three endpoints with the orders and fiscalization SERVICE seams
 * mocked - never a repository port.
 *
 * Two behaviours here are contract, not convenience, and are asserted as such:
 * the deterministic default idempotency key (which is what makes a double click
 * harmless), and the fact that a FAILED registration comes back as a 200 body
 * rather than an exception (an indeterminate outcome must stay visible, and the
 * caller needs the record id to reconcile against).
 *
 * @module apps/api/src/fiscalization/http
 */
import { Test } from '@nestjs/testing';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  FiscalReconcileCheckFailedException,
  FiscalReconcileOutcomeValues,
  FiscalRegistrationNotInDoubtException,
  FiscalRegistrationRecord,
  FiscalRegistrationRecordNotFoundException,
  OrderAlreadyRegisteredException,
} from '@openlinker/core/fiscalization';
import type { IFiscalRegistrationService } from '@openlinker/core/fiscalization';
import { ORDER_RECORD_SERVICE_TOKEN, OrderRecord } from '@openlinker/core/orders';
import type { IOrderRecordService } from '@openlinker/core/orders';
import 'reflect-metadata';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { FiscalizationController } from './fiscalization.controller';
import type { RegisterFiscalTransactionRequestDto } from './dto/register-fiscal-transaction-request.dto';

const NOW = new Date('2026-08-14T10:00:00.000Z');
const CONNECTION_ID = '00000000-0000-0000-0000-0000000019a8';
const ORDER_ID = 'ol_order_1';

function orderRecord(): OrderRecord {
  return new OrderRecord(
    ORDER_ID,
    'cust_1',
    'conn_src',
    null,
    {
      id: ORDER_ID,
      status: 'processing',
      items: [{ id: 'li_1', productId: 'p_1', quantity: 1, price: 100, name: 'Widget' }],
      totals: {
        subtotal: 100,
        tax: 0,
        shipping: 0,
        total: 100,
        currency: 'PLN',
        taxTreatment: 'inclusive',
      },
      // `orderFromReadySnapshot` refuses a snapshot with no usable address (see
      // the note on `rehydrateOrder`), so the fixture carries one.
      billingAddress: {
        firstName: 'Jan',
        lastName: 'Kowalski',
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '61-001',
        country: 'PL',
      },
      createdAt: '2026-08-10T08:00:00.000Z',
      updatedAt: '2026-08-11T09:30:00.000Z',
    },
    [],
    'ready',
    NOW,
    NOW,
  );
}

function registrationRecord(
  overrides: Partial<{
    status: 'pending' | 'registering' | 'registered' | 'failed';
    failureMode: 'rejected' | 'in-doubt' | null;
    failureReason: string | null;
    leaseExpiresAt: Date | null;
  }> = {},
): FiscalRegistrationRecord {
  return new FiscalRegistrationRecord(
    '11111111-1111-1111-1111-111111111111',
    CONNECTION_ID,
    ORDER_ID,
    'provider-a',
    `fiscal:${CONNECTION_ID}:${ORDER_ID}`,
    overrides.status ?? 'registered',
    'p-1',
    'd-1',
    's-1',
    NOW,
    { someRegimeKey: 'value' },
    [],
    overrides.failureMode ?? null,
    overrides.failureReason ?? null,
    'internal diagnostic that must never be exposed',
    overrides.leaseExpiresAt ?? null,
    NOW,
    NOW,
  );
}

describe('FiscalizationController', () => {
  let controller: FiscalizationController;
  let service: jest.Mocked<IFiscalRegistrationService>;
  let orders: jest.Mocked<Pick<IOrderRecordService, 'getOrderRecord'>>;

  beforeEach(async () => {
    service = {
      register: jest.fn(),
      getByOrderId: jest.fn(),
      getByOrderIds: jest.fn().mockResolvedValue([]),
      getById: jest.fn(),
      reconcileInDoubt: jest.fn(),
      getInFlightRegistration: jest.fn().mockResolvedValue(null),
    };
    orders = { getOrderRecord: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [FiscalizationController],
      providers: [
        { provide: FISCAL_REGISTRATION_SERVICE_TOKEN, useValue: service },
        { provide: ORDER_RECORD_SERVICE_TOKEN, useValue: orders },
      ],
    }).compile();

    controller = moduleRef.get(FiscalizationController);
  });

  describe('authorization', () => {
    it('should gate both writes to admin and leave the read open', () => {
      expect(Reflect.getMetadata(ROLES_KEY, FiscalizationController.prototype.register)).toEqual([
        'admin',
      ]);
      expect(
        Reflect.getMetadata(ROLES_KEY, FiscalizationController.prototype.reconcile),
      ).toEqual(['admin']);
      expect(
        Reflect.getMetadata(ROLES_KEY, FiscalizationController.prototype.listForOrder),
      ).toBeUndefined();
    });
  });

  describe('POST /fiscal-registrations', () => {
    it('should default the exactly-once key deterministically per (connection, order)', async () => {
      // This is what makes a double click harmless without the client having to
      // remember to send a key.
      orders.getOrderRecord.mockResolvedValue(orderRecord());
      service.register.mockResolvedValue(registrationRecord());

      await controller.register({ connectionId: CONNECTION_ID, orderId: ORDER_ID });

      expect(service.register).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: `fiscal:${CONNECTION_ID}:${ORDER_ID}` }),
      );
    });

    it('should mint its own key even if a caller smuggles one into the body', async () => {
      // The regression this pins: a caller-chosen key misses the
      // `(connectionId, idempotencyKey)` read gate, inserts a second row, wins its
      // claim and calls the provider again - the same sale registered twice. The
      // field is off the request DTO (so `forbidNonWhitelisted` 400s it at the
      // pipe), and the controller must not read one even if it arrives.
      orders.getOrderRecord.mockResolvedValue(orderRecord());
      service.register.mockResolvedValue(registrationRecord());

      await controller.register({
        connectionId: CONNECTION_ID,
        orderId: ORDER_ID,
        idempotencyKey: 'retry-1',
      } as unknown as RegisterFiscalTransactionRequestDto);

      expect(service.register).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: `fiscal:${CONNECTION_ID}:${ORDER_ID}` }),
      );
    });

    it('should 409 when the order already carries a blocking registration', async () => {
      // The service refuses a second ORIGINATING registration; the operator needs
      // that as a conflict naming the blocking record, not a 500.
      orders.getOrderRecord.mockResolvedValue(orderRecord());
      service.register.mockRejectedValue(
        new OrderAlreadyRegisteredException(
          ORDER_ID,
          'conn-other',
          CONNECTION_ID,
          'registered',
          'rec-first',
        ),
      );

      await expect(
        controller.register({ connectionId: CONNECTION_ID, orderId: ORDER_ID }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should compose the sale lines server-side from the order snapshot', async () => {
      orders.getOrderRecord.mockResolvedValue(orderRecord());
      service.register.mockResolvedValue(registrationRecord());

      await controller.register({ connectionId: CONNECTION_ID, orderId: ORDER_ID });

      expect(service.register).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: ORDER_ID,
          currency: 'PLN',
          totalGross: 100,
          lines: [
            { name: 'Widget', quantity: 1, unitPriceGross: 100, taxRate: '', sku: null },
          ],
        }),
      );
    });

    it('should 404 for an unknown order', async () => {
      orders.getOrderRecord.mockResolvedValue(null);

      await expect(
        controller.register({ connectionId: CONNECTION_ID, orderId: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(service.register).not.toHaveBeenCalled();
    });

    it('should 422 when the order snapshot cannot be rehydrated', async () => {
      const awaiting = new OrderRecord(
        ORDER_ID,
        null,
        'conn_src',
        null,
        {},
        [],
        'awaiting_mapping',
        NOW,
        NOW,
      );
      orders.getOrderRecord.mockResolvedValue(awaiting);

      await expect(
        controller.register({ connectionId: CONNECTION_ID, orderId: ORDER_ID }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(service.register).not.toHaveBeenCalled();
    });

    it('should register an order whose addresses are PII-redacted', async () => {
      // Under `OL_STORE_PII=false` every persisted address is a `[REDACTED]`
      // placeholder. The shared rehydrator's buyer gate is an INVOICING rule (an
      // invoice must name its buyer); applied here it 422'd every attempt and
      // made fiscalization unusable on such a deployment. A fiscal receipt names
      // no buyer, so the gate is opted out of - and nothing redacted reaches the
      // command: the recipient simply resolves to absent.
      const record = orderRecord();
      const redacted = new OrderRecord(
        record.internalOrderId,
        record.customerId,
        record.sourceConnectionId,
        null,
        {
          ...record.orderSnapshot,
          billingAddress: {
            address1: '[REDACTED]',
            city: '[REDACTED]',
            postalCode: '[REDACTED]',
            country: 'PL',
          },
        },
        [],
        'ready',
        NOW,
        NOW,
      );
      orders.getOrderRecord.mockResolvedValue(redacted);
      service.register.mockResolvedValue(registrationRecord());

      await controller.register({ connectionId: CONNECTION_ID, orderId: ORDER_ID });

      expect(service.register).toHaveBeenCalledWith(
        expect.objectContaining({ totalGross: 100 }),
      );
      expect(service.register.mock.calls[0]?.[0].recipient).toBeUndefined();
    });

    it('should return a FAILED registration as a body, not an exception', async () => {
      // An in-doubt outcome must stay visible and carry its record id; throwing
      // would hide both.
      orders.getOrderRecord.mockResolvedValue(orderRecord());
      service.register.mockResolvedValue(
        registrationRecord({
          status: 'failed',
          failureMode: 'in-doubt',
          failureReason: 'The provider did not confirm the registration.',
        }),
      );

      const response = await controller.register({
        connectionId: CONNECTION_ID,
        orderId: ORDER_ID,
      });

      expect(response.status).toBe('failed');
      expect(response.failureMode).toBe('in-doubt');
      expect(response.id).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('should never expose the internal diagnostic', async () => {
      orders.getOrderRecord.mockResolvedValue(orderRecord());
      service.register.mockResolvedValue(registrationRecord({ status: 'failed' }));

      const response = await controller.register({
        connectionId: CONNECTION_ID,
        orderId: ORDER_ID,
      });

      expect(JSON.stringify(response)).not.toContain('internal diagnostic');
    });

    it('should project the neutral identity set, extras included', async () => {
      orders.getOrderRecord.mockResolvedValue(orderRecord());
      service.register.mockResolvedValue(registrationRecord());

      const response = await controller.register({
        connectionId: CONNECTION_ID,
        orderId: ORDER_ID,
      });

      expect(response).toMatchObject({
        providerReference: 'p-1',
        documentReference: 'd-1',
        signingIdentity: 's-1',
        regimeExtras: { someRegimeKey: 'value' },
        artefacts: [],
      });
      expect(response.registeredAt).toBe(NOW.toISOString());
    });
  });

  describe('GET /fiscal-registrations', () => {
    it('should require an orderId', async () => {
      await expect(controller.listForOrder('  ')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should return an empty list for an order nobody asked to register', async () => {
      // OpenLinker never asserts that an order requires a fiscal registration,
      // so "no records" is an ordinary answer rather than a 404.
      service.getByOrderId.mockResolvedValue([]);

      await expect(controller.listForOrder(ORDER_ID)).resolves.toEqual([]);
    });

    it('should project every record the order holds', async () => {
      service.getByOrderId.mockResolvedValue([registrationRecord()]);

      const response = await controller.listForOrder(ORDER_ID);

      expect(response).toHaveLength(1);
      expect(response[0]?.orderId).toBe(ORDER_ID);
    });
  });

  describe('in-flight signal (#2521)', () => {
    it('should report a live claim as in flight, without attempting anything', async () => {
      // Readable, so a panel can say "a registration for this order is already
      // running" instead of learning it from the 409 of an attempt it should
      // not have made.
      service.getByOrderId.mockResolvedValue([
        registrationRecord({
          status: 'registering',
          leaseExpiresAt: new Date(Date.now() + 60_000),
        }),
      ]);

      const response = await controller.listForOrder(ORDER_ID);

      expect(response[0]?.inFlight).toBe(true);
      expect(service.register).not.toHaveBeenCalled();
      expect(service.reconcileInDoubt).not.toHaveBeenCalled();
    });

    it('should report an EXPIRED claim as not in flight', async () => {
      // An expired lease means the previous attempt died. Reporting it as
      // running would tell an operator to wait for work nobody is doing.
      service.getByOrderId.mockResolvedValue([
        registrationRecord({
          status: 'registering',
          leaseExpiresAt: new Date(Date.now() - 1_000),
        }),
      ]);

      const response = await controller.listForOrder(ORDER_ID);

      expect(response[0]?.inFlight).toBe(false);
    });

    it('should report a settled record as not in flight', async () => {
      service.getByOrderId.mockResolvedValue([registrationRecord()]);

      const response = await controller.listForOrder(ORDER_ID);

      expect(response[0]?.inFlight).toBe(false);
    });
  });

  describe('POST /fiscal-registrations/:id/reconcile', () => {
    it('should report the outcome alongside the record', async () => {
      service.reconcileInDoubt.mockResolvedValue({
        outcome: 'resolved',
        record: registrationRecord(),
      });

      const response = await controller.reconcile('11111111-1111-1111-1111-111111111111');

      expect(response.outcome).toBe('resolved');
      expect(response.record.status).toBe('registered');
    });

    it('should distinguish "no match" from "cannot be asked"', async () => {
      service.reconcileInDoubt.mockResolvedValue({
        outcome: 'unsupported',
        record: registrationRecord({ status: 'failed', failureMode: 'in-doubt' }),
      });

      const response = await controller.reconcile('11111111-1111-1111-1111-111111111111');

      expect(response.outcome).toBe('unsupported');
      expect(response.record.failureMode).toBe('in-doubt');
    });

    it.each(FiscalReconcileOutcomeValues)(
      'should surface the `%s` outcome verbatim',
      async (outcome) => {
        // A panel offering "check with the provider" must be able to render
        // every answer the check can return, so each one has to reach it
        // unchanged rather than being collapsed into a boolean.
        service.reconcileInDoubt.mockResolvedValue({
          outcome,
          record:
            outcome === 'resolved'
              ? registrationRecord()
              : registrationRecord({ status: 'failed', failureMode: 'in-doubt' }),
        });

        const response = await controller.reconcile('11111111-1111-1111-1111-111111111111');

        expect(response.outcome).toBe(outcome);
      },
    );

    it('should leave the record untouched on every non-resolving outcome', async () => {
      // `not-found`, `unsupported` and `still-unknown` all mean the record stays
      // in doubt - none of them may look like progress to a caller.
      for (const outcome of ['not-found', 'unsupported', 'still-unknown'] as const) {
        service.reconcileInDoubt.mockResolvedValue({
          outcome,
          record: registrationRecord({ status: 'failed', failureMode: 'in-doubt' }),
        });

        const response = await controller.reconcile('11111111-1111-1111-1111-111111111111');

        expect(response.outcome).toBe(outcome);
        expect(response.record.status).toBe('failed');
        expect(response.record.failureMode).toBe('in-doubt');
      }
    });

    it('should 502 when the provider could not be asked, never report it as an outcome', async () => {
      // A failed CHECK is upstream and retryable. Reporting it as `unsupported`
      // would assert a structural fact about the adapter and tell an operator to
      // stop retrying something transient.
      service.reconcileInDoubt.mockRejectedValue(
        new FiscalReconcileCheckFailedException('rec-1', 'conn-1', 'socket hang up'),
      );

      await expect(
        controller.reconcile('11111111-1111-1111-1111-111111111111'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('should 409 when the record is not an in-doubt failure', async () => {
      service.reconcileInDoubt.mockRejectedValue(
        new FiscalRegistrationNotInDoubtException('rec-1', 'registered'),
      );

      await expect(
        controller.reconcile('11111111-1111-1111-1111-111111111111'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should 404 for an unknown record', async () => {
      service.reconcileInDoubt.mockRejectedValue(
        new FiscalRegistrationRecordNotFoundException('rec-1'),
      );

      await expect(
        controller.reconcile('11111111-1111-1111-1111-111111111111'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
