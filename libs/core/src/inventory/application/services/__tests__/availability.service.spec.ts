/**
 * Availability Service Unit Tests (#2321, ADR-061)
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { AvailabilityService } from '../availability.service';
import {
  INVENTORY_REPOSITORY_TOKEN,
  RESERVATION_LEDGER_READER_TOKEN,
} from '../../../inventory.tokens';
import type { InventoryRepositoryPort } from '../../../domain/ports/inventory-repository.port';
import type {
  ReservationLedgerReaderPort,
  SumReservedInput,
} from '../../../domain/ports/reservation-ledger-reader.port';
import { EmptyReservationLedgerReader } from '../../../infrastructure/reservations/empty-reservation-ledger.reader';
import { UnsupportedAvailabilityScopeError } from '../../../domain/exceptions/unsupported-availability-scope.error';
import type { AvailabilityScope } from '../../../domain/types/availability.types';
import type { VariantAvailability } from '../../../domain/types/inventory.types';
import {
  AVAILABILITY_PARITY_CASES,
  toConnectionConfig,
  toVariantAvailabilityRow,
} from './availability-parity.fixture';

const CONNECTION_ID = 'conn-1';
const CHANNEL_SCOPE: AvailabilityScope = { kind: 'channel', connectionId: CONNECTION_ID };
const OBSERVED_AT = new Date('2026-08-20T10:00:00.000Z');
const NOW = new Date('2026-08-20T10:05:00.000Z');

/** An in-memory ledger holding both stamps, so only `published` may reduce ATP. */
class FakeReservationLedger implements ReservationLedgerReaderPort {
  public readonly calls: SumReservedInput[] = [];

  constructor(
    private readonly rows: readonly {
      variantId: string;
      quantity: number;
      atpEffect: 'published' | 'diagnostic';
    }[]
  ) {}

  sumReservedByVariantIds(input: SumReservedInput): Promise<ReadonlyMap<string, number>> {
    this.calls.push(input);
    const sums = new Map<string, number>();
    for (const row of this.rows) {
      if (row.atpEffect !== input.atpEffect) continue;
      if (!input.variantIds.includes(row.variantId)) continue;
      sums.set(row.variantId, (sums.get(row.variantId) ?? 0) + row.quantity);
    }
    return Promise.resolve(sums);
  }
}

class ThrowingReservationLedger implements ReservationLedgerReaderPort {
  sumReservedByVariantIds(): Promise<ReadonlyMap<string, number>> {
    return Promise.reject(new Error('ledger unavailable'));
  }
}

describe('AvailabilityService', () => {
  let repository: jest.Mocked<Pick<InventoryRepositoryPort, 'findAvailabilityByVariantIds'>>;
  let connectionPort: jest.Mocked<Pick<ConnectionPort, 'get'>>;

  const build = async (ledger: ReservationLedgerReaderPort): Promise<AvailabilityService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        { provide: INVENTORY_REPOSITORY_TOKEN, useValue: repository },
        { provide: CONNECTION_PORT_TOKEN, useValue: connectionPort },
        { provide: RESERVATION_LEDGER_READER_TOKEN, useValue: ledger },
      ],
    }).compile();
    return module.get(AvailabilityService);
  };

  const withConfig = (config: Record<string, unknown>): void => {
    connectionPort.get.mockResolvedValue({
      id: CONNECTION_ID,
      config,
    } as unknown as Awaited<ReturnType<ConnectionPort['get']>>);
  };

  const withRows = (rows: readonly VariantAvailability[]): void => {
    repository.findAvailabilityByVariantIds.mockResolvedValue(rows);
  };

  beforeEach(() => {
    repository = { findAvailabilityByVariantIds: jest.fn().mockResolvedValue([]) };
    connectionPort = { get: jest.fn() };
    withConfig({});
  });

  describe('parity with the shipped publish arithmetic', () => {
    it.each(AVAILABILITY_PARITY_CASES.map((c) => [c.name, c] as const))(
      'matches the published quantity for %s',
      async (_name, testCase) => {
        withConfig(toConnectionConfig(testCase));
        const row = toVariantAvailabilityRow('v1', testCase, OBSERVED_AT);
        withRows(row ? [row] : []);

        const service = await build(new EmptyReservationLedgerReader());
        const [result] = await service.getPromisableQuantities({
          variantIds: ['v1'],
          scope: CHANNEL_SCOPE,
          now: NOW,
        });

        expect(result.quantity).toBe(testCase.expectedPublishedQuantity);
        expect(result.provenance).toBe('computed');
      }
    );
  });

  describe('the reservation ledger term', () => {
    it('should request the published stamp explicitly when computing ATP', async () => {
      const ledger = new FakeReservationLedger([]);
      withRows([
        { productVariantId: 'v1', totalAvailable: 10, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(ledger);
      await service.getPromisableQuantities({ variantIds: ['v1'], scope: CHANNEL_SCOPE, now: NOW });

      expect(ledger.calls).toHaveLength(1);
      expect(ledger.calls[0].atpEffect).toBe('published');
      expect(ledger.calls[0].scope).toEqual(CHANNEL_SCOPE);
    });

    it('should subtract published reservations and ignore diagnostic ones', async () => {
      // The AC's "seeds a non-published reservation row": no ledger table exists
      // in Wave 1b, so the in-memory fake carrying both stamps is what proves a
      // diagnostic hold reduces nothing.
      const ledger = new FakeReservationLedger([
        { variantId: 'v1', quantity: 4, atpEffect: 'published' },
        { variantId: 'v1', quantity: 100, atpEffect: 'diagnostic' },
      ]);
      withRows([
        { productVariantId: 'v1', totalAvailable: 10, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(ledger);
      const [result] = await service.getPromisableQuantities({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(result.quantity).toBe(6);
    });

    it('should never let a published reservation drive the quantity below zero', async () => {
      const ledger = new FakeReservationLedger([
        { variantId: 'v1', quantity: 50, atpEffect: 'published' },
      ]);
      withRows([
        { productVariantId: 'v1', totalAvailable: 10, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(ledger);
      const [result] = await service.getPromisableQuantities({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(result.quantity).toBe(0);
      expect(result.provenance).toBe('computed');
    });

    it('should be byte-identical to the un-reserved quantity while the ledger is empty', async () => {
      withConfig({ stockSafetyBuffer: 3 });
      withRows([
        { productVariantId: 'v1', totalAvailable: 10, locationCount: 2, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(new EmptyReservationLedgerReader());
      const [result] = await service.getPromisableQuantities({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(result.quantity).toBe(7);
    });
  });

  describe('provenance', () => {
    it('should report a zero-row variant as a known zero, not as unknown', async () => {
      withRows([]);

      const service = await build(new EmptyReservationLedgerReader());
      const [result] = await service.getPromisableQuantities({
        variantIds: ['v-missing'],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(result).toEqual({
        productVariantId: 'v-missing',
        quantity: 0,
        provenance: 'computed',
        observedAt: null,
        stalenessMs: null,
      });
    });

    it('should report unknown BATCH-WIDE when the ledger read throws', async () => {
      withRows([
        { productVariantId: 'v1', totalAvailable: 10, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
        { productVariantId: 'v2', totalAvailable: 5, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(new ThrowingReservationLedger());
      const results = await service.getPromisableQuantities({
        variantIds: ['v1', 'v2'],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result.provenance).toBe('unknown');
        // Never swallowed to 0 — that publishes the un-reserved quantity.
        expect(result.quantity).toBeNull();
      }
    });

    it('should never produce authority provenance in this wave', async () => {
      withRows([
        { productVariantId: 'v1', totalAvailable: 10, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(new EmptyReservationLedgerReader());
      const results = await service.getPromisableQuantities({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(results.every((r) => r.provenance !== 'authority')).toBe(true);
    });
  });

  describe('observation time', () => {
    it('should report stalenessMs against the injected clock', async () => {
      withRows([
        { productVariantId: 'v1', totalAvailable: 1, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(new EmptyReservationLedgerReader());
      const [result] = await service.getPromisableQuantities({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(result.observedAt).toEqual(OBSERVED_AT);
      expect(result.stalenessMs).toBe(5 * 60 * 1000);
    });
  });

  describe('scope handling', () => {
    it('should apply the connection buffer for a channel scope', async () => {
      withConfig({ stockSafetyBuffer: 4 });
      withRows([
        { productVariantId: 'v1', totalAvailable: 10, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(new EmptyReservationLedgerReader());
      const [result] = await service.getPromisableQuantities({
        variantIds: ['v1'],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(connectionPort.get).toHaveBeenCalledWith(CONNECTION_ID);
      expect(result.quantity).toBe(6);
    });

    it('should apply no buffer for a global scope and never read a connection', async () => {
      withRows([
        { productVariantId: 'v1', totalAvailable: 10, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(new EmptyReservationLedgerReader());
      const [result] = await service.getPromisableQuantities({
        variantIds: ['v1'],
        scope: { kind: 'global' },
        now: NOW,
      });

      expect(result.quantity).toBe(10);
      expect(connectionPort.get).not.toHaveBeenCalled();
    });

    it.each([
      ['location', { kind: 'location', locationId: 'loc-1' } as const],
      ['order', { kind: 'order', orderId: 'ord-1' } as const],
      ['work', { kind: 'work', workId: 'work-1' } as const],
    ])('should throw rather than silently ignore a %s scope', async (_kind, scope) => {
      const service = await build(new EmptyReservationLedgerReader());

      await expect(
        service.getPromisableQuantities({ variantIds: ['v1'], scope, now: NOW })
      ).rejects.toBeInstanceOf(UnsupportedAvailabilityScopeError);
      expect(repository.findAvailabilityByVariantIds).not.toHaveBeenCalled();
    });
  });

  describe('batch shape', () => {
    it('should return [] without touching the repository for empty input', async () => {
      const ledger = new FakeReservationLedger([]);

      const service = await build(ledger);
      const results = await service.getPromisableQuantities({
        variantIds: [],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(results).toEqual([]);
      expect(repository.findAvailabilityByVariantIds).not.toHaveBeenCalled();
      expect(ledger.calls).toHaveLength(0);
    });

    it('should zero-fill and preserve input order', async () => {
      withRows([
        { productVariantId: 'v2', totalAvailable: 5, locationCount: 1, stockUpdatedAt: OBSERVED_AT },
      ]);

      const service = await build(new EmptyReservationLedgerReader());
      const results = await service.getPromisableQuantities({
        variantIds: ['v1', 'v2', 'v3'],
        scope: CHANNEL_SCOPE,
        now: NOW,
      });

      expect(results.map((r) => r.productVariantId)).toEqual(['v1', 'v2', 'v3']);
      expect(results.map((r) => r.quantity)).toEqual([0, 5, 0]);
    });
  });
});
