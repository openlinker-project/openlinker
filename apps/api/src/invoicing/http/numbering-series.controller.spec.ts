/**
 * NumberingSeriesController unit tests (#1576, C2)
 *
 * Covers series CRUD (DTO-independent behaviour: validation delegation, error
 * mapping, periodKey seeding), connection assignment (attach/detach/read,
 * referenced-series validation), the orphaned-series list (last-issued
 * derivation), and role-guard metadata. The repository port is mocked — no DB.
 *
 * @module apps/api/src/invoicing/http
 */
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import 'reflect-metadata';
import {
  DuplicateDocumentNumberException,
  INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN,
  InvoiceNumberingSeries,
  InvoiceNumberingSeriesNotFoundException,
  computePeriodKey,
} from '@openlinker/core/invoicing';
import type {
  InvoiceNumberingSeriesRepositoryPort,
  SeriesAssignmentData,
} from '@openlinker/core/invoicing';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { NumberingSeriesController } from './numbering-series.controller';

const NOW = new Date('2026-06-23T10:00:00.000Z');

function seriesFixture(overrides: Partial<InvoiceNumberingSeries> = {}): InvoiceNumberingSeries {
  return new InvoiceNumberingSeries(
    overrides.id ?? '11111111-1111-4111-8111-111111111111',
    overrides.name ?? 'Sales invoices 2026',
    overrides.pattern ?? 'FV/{YYYY}/{seq}',
    overrides.nextSeq ?? 1,
    overrides.seqPadding ?? 5,
    overrides.resetPolicy ?? 'yearly',
    overrides.periodKey ?? '2026',
    overrides.createdAt ?? NOW,
    overrides.updatedAt ?? NOW,
  );
}

function assignmentFixture(overrides: Partial<SeriesAssignmentData> = {}): SeriesAssignmentData {
  return {
    connectionId: overrides.connectionId ?? 'conn-1',
    mainSeriesId: overrides.mainSeriesId ?? '11111111-1111-4111-8111-111111111111',
    correctionSeriesId: overrides.correctionSeriesId ?? null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

describe('NumberingSeriesController', () => {
  let controller: NumberingSeriesController;
  let repository: jest.Mocked<InvoiceNumberingSeriesRepositoryPort>;

  beforeEach(async () => {
    repository = {
      createSeries: jest.fn(),
      findSeriesById: jest.fn(),
      listSeries: jest.fn(),
      listUnassignedSeries: jest.fn(),
      updateSeries: jest.fn(),
      findAssignmentByConnectionId: jest.fn(),
      upsertAssignment: jest.fn(),
      deleteAssignmentByConnectionId: jest.fn(),
      allocateNumber: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NumberingSeriesController],
      providers: [{ provide: INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN, useValue: repository }],
    }).compile();

    controller = moduleRef.get(NumberingSeriesController);
  });

  describe('createSeries', () => {
    it('should create a series and seed periodKey via computePeriodKey when the pattern is valid', async () => {
      const created = seriesFixture();
      repository.createSeries.mockResolvedValue(created);

      const result = await controller.createSeries({
        name: 'Sales invoices 2026',
        pattern: 'FV/{YYYY}/{seq}',
        nextSeq: 1,
        seqPadding: 5,
        resetPolicy: 'yearly',
      });

      const [input] = repository.createSeries.mock.calls[0];
      expect(input.periodKey).toBe(computePeriodKey('yearly', new Date()));
      expect(input.periodKey).not.toBe('');
      expect(result.id).toBe(created.id);
      expect(result.createdAt).toBe(NOW.toISOString());
    });

    it('should return 400 with the issue list when the pattern is invalid', async () => {
      await expect(
        controller.createSeries({
          name: 'Bad',
          pattern: 'FV/{YYYY}', // missing {seq}
          nextSeq: 1,
          seqPadding: 0,
          resetPolicy: 'yearly',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createSeries).not.toHaveBeenCalled();
    });

    it('should return 400 when the reset policy is not covered by the pattern', async () => {
      await expect(
        controller.createSeries({
          name: 'Monthly no month',
          pattern: 'FV/{YYYY}/{seq}', // monthly needs {MM}
          nextSeq: 1,
          seqPadding: 0,
          resetPolicy: 'monthly',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listSeries', () => {
    it('should map all series to response DTOs', async () => {
      repository.listSeries.mockResolvedValue([seriesFixture()]);
      const result = await controller.listSeries();
      expect(result).toHaveLength(1);
      expect(result[0].pattern).toBe('FV/{YYYY}/{seq}');
    });
  });

  describe('listUnassignedSeries', () => {
    it('should derive lastIssuedSeq and a rendered preview when numbers were issued', async () => {
      repository.listUnassignedSeries.mockResolvedValue([seriesFixture({ nextSeq: 43 })]);
      const result = await controller.listUnassignedSeries();
      expect(result[0].lastIssuedSeq).toBe(42);
      expect(result[0].lastIssuedNumberPreview).toBe('FV/2026/00042');
    });

    it('should return null last-issued fields when nothing has been issued (nextSeq=1)', async () => {
      repository.listUnassignedSeries.mockResolvedValue([seriesFixture({ nextSeq: 1 })]);
      const result = await controller.listUnassignedSeries();
      expect(result[0].lastIssuedSeq).toBeNull();
      expect(result[0].lastIssuedNumberPreview).toBeNull();
    });
  });

  describe('getSeries', () => {
    it('should return the series when found', async () => {
      repository.findSeriesById.mockResolvedValue(seriesFixture());
      const result = await controller.getSeries('11111111-1111-4111-8111-111111111111');
      expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('should throw 404 when not found', async () => {
      repository.findSeriesById.mockResolvedValue(null);
      await expect(controller.getSeries('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateSeries', () => {
    it('should throw 404 when the series does not exist', async () => {
      repository.findSeriesById.mockResolvedValue(null);
      await expect(controller.updateSeries('missing', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.updateSeries).not.toHaveBeenCalled();
    });

    it('should apply a name-only patch without re-validating the pattern', async () => {
      repository.findSeriesById.mockResolvedValue(seriesFixture());
      repository.updateSeries.mockResolvedValue(seriesFixture({ name: 'Renamed' }));
      const result = await controller.updateSeries('11111111-1111-4111-8111-111111111111', {
        name: 'Renamed',
      });
      expect(repository.updateSeries).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
        name: 'Renamed',
      });
      expect(result.name).toBe('Renamed');
    });

    it('should re-validate the merged pattern + reset policy and 400 on an incompatible pair', async () => {
      repository.findSeriesById.mockResolvedValue(seriesFixture({ resetPolicy: 'yearly' }));
      await expect(
        controller.updateSeries('11111111-1111-4111-8111-111111111111', { resetPolicy: 'monthly' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.updateSeries).not.toHaveBeenCalled();
    });

    it('should re-seed periodKey when the reset policy changes to a valid coverage', async () => {
      repository.findSeriesById.mockResolvedValue(
        seriesFixture({ pattern: 'FV/{YYYY}/{MM}/{seq}', resetPolicy: 'yearly' }),
      );
      repository.updateSeries.mockResolvedValue(seriesFixture());
      await controller.updateSeries('11111111-1111-4111-8111-111111111111', {
        resetPolicy: 'monthly',
      });
      const [, patch] = repository.updateSeries.mock.calls[0];
      expect(patch.periodKey).toBe(computePeriodKey('monthly', new Date()));
    });

    it('should map InvoiceNumberingSeriesNotFoundException from the repo to 404', async () => {
      repository.findSeriesById.mockResolvedValue(seriesFixture());
      repository.updateSeries.mockRejectedValue(
        new InvoiceNumberingSeriesNotFoundException('11111111-1111-4111-8111-111111111111'),
      );
      await expect(
        controller.updateSeries('11111111-1111-4111-8111-111111111111', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should map DuplicateDocumentNumberException from the repo to 409', async () => {
      repository.findSeriesById.mockResolvedValue(seriesFixture());
      repository.updateSeries.mockRejectedValue(new DuplicateDocumentNumberException('conn-1', 'FV/2026/1'));
      await expect(
        controller.updateSeries('11111111-1111-4111-8111-111111111111', { nextSeq: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getAssignment', () => {
    it('should return the assignment when configured', async () => {
      repository.findAssignmentByConnectionId.mockResolvedValue(assignmentFixture());
      const result = await controller.getAssignment('conn-1');
      expect(result.connectionId).toBe('conn-1');
      expect(result.correctionSeriesId).toBeNull();
    });

    it('should throw 404 when the connection has no assignment', async () => {
      repository.findAssignmentByConnectionId.mockResolvedValue(null);
      await expect(controller.getAssignment('conn-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setAssignment', () => {
    it('should upsert when the main series exists and no correction is given', async () => {
      repository.findSeriesById.mockResolvedValue(seriesFixture());
      repository.upsertAssignment.mockResolvedValue(assignmentFixture());
      const result = await controller.setAssignment('conn-1', {
        mainSeriesId: '11111111-1111-4111-8111-111111111111',
      });
      expect(repository.upsertAssignment).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        mainSeriesId: '11111111-1111-4111-8111-111111111111',
        correctionSeriesId: null,
      });
      expect(result.connectionId).toBe('conn-1');
    });

    it('should validate the correction series exists when provided', async () => {
      repository.findSeriesById
        .mockResolvedValueOnce(seriesFixture()) // main
        .mockResolvedValueOnce(null); // correction missing
      await expect(
        controller.setAssignment('conn-1', {
          mainSeriesId: '11111111-1111-4111-8111-111111111111',
          correctionSeriesId: '22222222-2222-4222-8222-222222222222',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.upsertAssignment).not.toHaveBeenCalled();
    });

    it('should 400 when the main series does not exist', async () => {
      repository.findSeriesById.mockResolvedValue(null);
      await expect(
        controller.setAssignment('conn-1', { mainSeriesId: 'missing' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('detachAssignment', () => {
    it('should delegate to the repository (no-op safe)', async () => {
      repository.deleteAssignmentByConnectionId.mockResolvedValue(undefined);
      await controller.detachAssignment('conn-1');
      expect(repository.deleteAssignmentByConnectionId).toHaveBeenCalledWith('conn-1');
    });
  });

  describe('role guards', () => {
    it('should gate all write endpoints behind @Roles(admin) and leave reads open', () => {
      const admin = (method: string): unknown =>
        Reflect.getMetadata(
          ROLES_KEY,
          NumberingSeriesController.prototype[method as keyof NumberingSeriesController] as object,
        ) as unknown;
      expect(admin('createSeries')).toEqual(['admin']);
      expect(admin('updateSeries')).toEqual(['admin']);
      expect(admin('setAssignment')).toEqual(['admin']);
      expect(admin('detachAssignment')).toEqual(['admin']);
      expect(admin('listSeries')).toBeUndefined();
      expect(admin('getSeries')).toBeUndefined();
      expect(admin('listUnassignedSeries')).toBeUndefined();
      expect(admin('getAssignment')).toBeUndefined();
    });
  });
});
