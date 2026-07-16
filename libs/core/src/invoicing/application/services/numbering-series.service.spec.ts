/**
 * NumberingSeriesService unit tests (#9 / #10)
 *
 * Covers the logic that moved out of the C2 controller into the service: pattern
 * validation, periodKey seeding on create, effective-pattern re-validation and
 * periodKey re-seeding on update, the in-memory documentType/register filter, and
 * the routing passthroughs. The repository port is mocked.
 *
 * @module libs/core/src/invoicing/application/services
 */
import 'reflect-metadata';
import { InvoiceNumberingSeries } from '../../domain/entities/invoice-numbering-series.entity';
import { InvalidNumberingPatternException } from '../../domain/exceptions/invalid-numbering-pattern.exception';
import { InvoiceNumberingSeriesNotFoundException } from '../../domain/exceptions/invoice-numbering-series-not-found.exception';
import { computePeriodKey } from '../../domain/numbering/invoice-number-pattern';
import type { InvoiceNumberingSeriesRepositoryPort } from '../../domain/ports/invoice-numbering-series-repository.port';
import { NumberingSeriesService } from './numbering-series.service';

const NOW = new Date('2026-06-23T10:00:00.000Z');

function seriesFixture(overrides: Partial<InvoiceNumberingSeries> = {}): InvoiceNumberingSeries {
  return new InvoiceNumberingSeries(
    overrides.id ?? 'series-1',
    overrides.name ?? 'Sales 2026',
    overrides.pattern ?? 'FV/{YYYY}/{seq}',
    overrides.nextSeq ?? 1,
    overrides.seqPadding ?? 5,
    overrides.resetPolicy ?? 'yearly',
    overrides.periodKey ?? '2026',
    overrides.documentType ?? 'invoice',
    overrides.register ?? null,
    overrides.createdAt ?? NOW,
    overrides.updatedAt ?? NOW,
  );
}

describe('NumberingSeriesService', () => {
  let repository: jest.Mocked<InvoiceNumberingSeriesRepositoryPort>;
  let service: NumberingSeriesService;

  beforeEach(() => {
    repository = {
      createSeries: jest.fn(),
      findSeriesById: jest.fn(),
      listSeries: jest.fn(),
      listUnassignedSeries: jest.fn(),
      updateSeries: jest.fn(),
      findSeriesIdForDocument: jest.fn(),
      findRoutesByConnectionId: jest.fn(),
      upsertRoute: jest.fn(),
      deleteRoute: jest.fn(),
      allocateNumber: jest.fn(),
    };
    service = new NumberingSeriesService(repository);
  });

  describe('createSeries', () => {
    it('should validate the pattern, seed periodKey, and default documentType/register', async () => {
      repository.createSeries.mockResolvedValue(seriesFixture());
      await service.createSeries({
        name: 'Sales 2026',
        pattern: 'FV/{YYYY}/{seq}',
        nextSeq: 1,
        seqPadding: 5,
        resetPolicy: 'yearly',
      });
      const [input] = repository.createSeries.mock.calls[0];
      expect(input.documentType).toBe('invoice');
      expect(input.register).toBeNull();
      expect(input.periodKey).toBe(computePeriodKey('yearly', new Date()));
      expect(input.periodKey).not.toBe('');
    });

    it('should throw InvalidNumberingPatternException when the pattern lacks {seq}', async () => {
      await expect(
        service.createSeries({
          name: 'Bad',
          pattern: 'FV/{YYYY}',
          nextSeq: 1,
          seqPadding: 0,
          resetPolicy: 'yearly',
        }),
      ).rejects.toBeInstanceOf(InvalidNumberingPatternException);
      expect(repository.createSeries).not.toHaveBeenCalled();
    });

    it('should throw when the reset policy is not covered by the pattern', async () => {
      await expect(
        service.createSeries({
          name: 'Monthly no month',
          pattern: 'FV/{YYYY}/{seq}',
          nextSeq: 1,
          seqPadding: 0,
          resetPolicy: 'monthly',
        }),
      ).rejects.toBeInstanceOf(InvalidNumberingPatternException);
    });

    it('should pass explicit documentType and register through', async () => {
      repository.createSeries.mockResolvedValue(seriesFixture());
      await service.createSeries({
        name: 'Corrections',
        pattern: 'KOR/{YYYY}/{seq}',
        nextSeq: 1,
        seqPadding: 0,
        resetPolicy: 'yearly',
        documentType: 'corrected',
        register: 'BR1',
      });
      const [input] = repository.createSeries.mock.calls[0];
      expect(input.documentType).toBe('corrected');
      expect(input.register).toBe('BR1');
    });
  });

  describe('updateSeries', () => {
    it('should throw InvoiceNumberingSeriesNotFoundException when the id is unknown', async () => {
      repository.findSeriesById.mockResolvedValue(null);
      await expect(service.updateSeries('missing', { name: 'x' })).rejects.toBeInstanceOf(
        InvoiceNumberingSeriesNotFoundException,
      );
      expect(repository.updateSeries).not.toHaveBeenCalled();
    });

    it('should apply a name-only patch without re-validating the pattern', async () => {
      repository.findSeriesById.mockResolvedValue(seriesFixture());
      repository.updateSeries.mockResolvedValue(seriesFixture({ name: 'Renamed' }));
      await service.updateSeries('series-1', { name: 'Renamed' });
      expect(repository.updateSeries).toHaveBeenCalledWith('series-1', { name: 'Renamed' });
    });

    it('should re-validate the merged pattern + reset policy and throw on an incompatible pair', async () => {
      repository.findSeriesById.mockResolvedValue(seriesFixture({ resetPolicy: 'yearly' }));
      await expect(
        service.updateSeries('series-1', { resetPolicy: 'monthly' }),
      ).rejects.toBeInstanceOf(InvalidNumberingPatternException);
      expect(repository.updateSeries).not.toHaveBeenCalled();
    });

    it('should re-seed periodKey when the reset policy changes to a valid coverage', async () => {
      repository.findSeriesById.mockResolvedValue(
        seriesFixture({ pattern: 'FV/{YYYY}/{MM}/{seq}', resetPolicy: 'yearly' }),
      );
      repository.updateSeries.mockResolvedValue(seriesFixture());
      await service.updateSeries('series-1', { resetPolicy: 'monthly' });
      const [, patch] = repository.updateSeries.mock.calls[0];
      expect(patch.periodKey).toBe(computePeriodKey('monthly', new Date()));
    });
  });

  describe('listSeries', () => {
    it('should filter by documentType and register in memory', async () => {
      repository.listSeries.mockResolvedValue([
        seriesFixture({ id: 'a', documentType: 'invoice', register: null }),
        seriesFixture({ id: 'b', documentType: 'corrected', register: 'BR1' }),
        seriesFixture({ id: 'c', documentType: 'invoice', register: 'BR1' }),
      ]);
      const result = await service.listSeries({ documentType: 'invoice', register: 'BR1' });
      expect(result.map((s) => s.id)).toEqual(['c']);
    });

    it('should return all series when no filter is given', async () => {
      repository.listSeries.mockResolvedValue([seriesFixture()]);
      const result = await service.listSeries();
      expect(result).toHaveLength(1);
    });
  });

  describe('seriesExists', () => {
    it('should be true when the series is found and false otherwise', async () => {
      repository.findSeriesById.mockResolvedValueOnce(seriesFixture());
      expect(await service.seriesExists('series-1')).toBe(true);
      repository.findSeriesById.mockResolvedValueOnce(null);
      expect(await service.seriesExists('missing')).toBe(false);
    });
  });
});
