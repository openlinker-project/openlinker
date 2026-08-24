/**
 * Availability Service Unit Tests (#2321, ADR-061)
 *
 * @module libs/core/src/inventory/application/services/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
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
import type { VariantStockRow } from '../../../domain/types/inventory.types';
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

  const withRows = (rows: readonly VariantStockRow[]): void => {
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

  /**
   * The publish-Control seam (#2323).
   *
   * The parity matrix above already pins the arithmetic; these cases pin the
   * behaviour the four rewired sites depend on — the scope split, the
   * `unknown` degradation, and the invalid-buffer warning, which used to live
   * as four near-identical private copies and now lives here alone.
   */
  describe('applyPublishControls (#2323)', () => {
    it.each(AVAILABILITY_PARITY_CASES.map((c) => [c.name, c] as const))(
      'produces the shipped published quantity for %s',
      async (_name, testCase) => {
        withConfig(toConnectionConfig(testCase));

        const service = await build(new EmptyReservationLedgerReader());
        const result = await service.applyPublishControls({
          // The publish sites pass a caller-supplied quantity, so feed the
          // case's master stock in that position — the arithmetic under test
          // is `max(0, quantity − buffer)`.
          quantity: testCase.rows
            .filter((r) => !r.isStale)
            .reduce((acc, r) => acc + r.availableQuantity, 0),
          scope: CHANNEL_SCOPE,
        });

        expect(result).toEqual({
          quantity: testCase.expectedPublishedQuantity,
          provenance: 'computed',
        });
      }
    );

    it('should floor at 0 rather than publish a negative quantity', async () => {
      withConfig({ stockSafetyBuffer: 5 });

      const service = await build(new EmptyReservationLedgerReader());

      expect(await service.applyPublishControls({ quantity: 2, scope: CHANNEL_SCOPE })).toEqual({
        quantity: 0,
        provenance: 'computed',
      });
    });

    it('should apply no buffer in the global scope', async () => {
      withConfig({ stockSafetyBuffer: 5 });

      const service = await build(new EmptyReservationLedgerReader());
      const result = await service.applyPublishControls({
        quantity: 10,
        scope: { kind: 'global' },
      });

      // A global read has no destination whose cushion it could borrow.
      expect(result).toEqual({ quantity: 10, provenance: 'computed' });
      expect(connectionPort.get).not.toHaveBeenCalled();
    });

    it('should report unknown (never the unbuffered quantity) when the control read fails', async () => {
      connectionPort.get.mockRejectedValue(new Error('connection store unavailable'));

      const service = await build(new EmptyReservationLedgerReader());
      const result = await service.applyPublishControls({ quantity: 10, scope: CHANNEL_SCOPE });

      expect(result).toEqual({ quantity: null, provenance: 'unknown' });
    });

    it('should rethrow an unsupported scope rather than degrade it to unknown', async () => {
      const service = await build(new EmptyReservationLedgerReader());

      // A scope the seam does not implement is a CALLER bug. Reporting it as
      // `unknown` would send an operator hunting a healthy integration.
      await expect(
        service.applyPublishControls({ quantity: 1, scope: { kind: 'order', orderId: 'o-1' } })
      ).rejects.toThrow(UnsupportedAvailabilityScopeError);
    });

    // Moved here from `inventory-sync.service.spec.ts` (#2323): the warning is
    // now emitted from exactly one place, so it is asserted in exactly one.
    it('should warn (but still pass the quantity through) when the buffer is present but invalid', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      withConfig({ stockSafetyBuffer: -3 });

      const service = await build(new EmptyReservationLedgerReader());
      const result = await service.applyPublishControls({ quantity: 10, scope: CHANNEL_SCOPE });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('present but invalid'));
      // Coerces to a 0 reserve => the quantity passes through unchanged.
      expect(result.quantity).toBe(10);
      warnSpy.mockRestore();
    });

    it('should not warn when the buffer is absent (default 0)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      withConfig({});

      const service = await build(new EmptyReservationLedgerReader());
      await service.applyPublishControls({ quantity: 10, scope: CHANNEL_SCOPE });

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('present but invalid'));
      warnSpy.mockRestore();
    });
  });

  describe('getAppliedReserve (#2323)', () => {
    it('should report the configured reserve for a channel scope', async () => {
      withConfig({ stockSafetyBuffer: 4 });

      const service = await build(new EmptyReservationLedgerReader());

      expect(await service.getAppliedReserve(CHANNEL_SCOPE)).toBe(4);
    });

    it('should report 0 for an invalid reserve, matching what is actually applied', async () => {
      withConfig({ stockSafetyBuffer: '5' });

      const service = await build(new EmptyReservationLedgerReader());

      // Displaying "5" while applying 0 would tell the operator a protection
      // is in force that is not.
      expect(await service.getAppliedReserve(CHANNEL_SCOPE)).toBe(0);
    });

    it('should report 0 for the global scope', async () => {
      withConfig({ stockSafetyBuffer: 4 });

      const service = await build(new EmptyReservationLedgerReader());

      expect(await service.getAppliedReserve({ kind: 'global' })).toBe(0);
    });
  });
});
