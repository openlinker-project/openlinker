/**
 * NumberingSeriesController unit tests (#9 / #10 / #8)
 *
 * Covers series CRUD (delegation + error mapping), per-document-type routing
 * (list / upsert-with-unknown-series guard / detach), the orphaned-series list
 * (last-issued derivation), and the gap-audit surface (audit read + gap-note
 * explain). Both core application services are mocked — no DB, no domain logic in
 * the controller.
 *
 * @module apps/api/src/invoicing/http
 */
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import 'reflect-metadata';
import {
  DuplicateDocumentNumberException,
  InvalidNumberingPatternException,
  InvoiceNumberingSeries,
  InvoiceNumberingSeriesNotFoundException,
  NUMBERING_AUDIT_SERVICE_TOKEN,
  NUMBERING_SERIES_SERVICE_TOKEN,
  NumberingGapNoteReasonRequiredException,
} from '@openlinker/core/invoicing';
import type {
  INumberingAuditService,
  INumberingSeriesService,
  NumberingGapNoteData,
  SeriesAudit,
  SeriesRouteData,
} from '@openlinker/core/invoicing';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { NumberingSeriesController } from './numbering-series.controller';

const NOW = new Date('2026-06-23T10:00:00.000Z');
const ADMIN: AuthenticatedUser = { id: 'user-1', username: 'admin', role: 'admin' };

function seriesFixture(overrides: Partial<InvoiceNumberingSeries> = {}): InvoiceNumberingSeries {
  return new InvoiceNumberingSeries(
    overrides.id ?? '11111111-1111-4111-8111-111111111111',
    overrides.name ?? 'Sales invoices 2026',
    overrides.pattern ?? 'FV/{YYYY}/{seq}',
    overrides.nextSeq ?? 1,
    overrides.seqPadding ?? 5,
    overrides.resetPolicy ?? 'yearly',
    overrides.periodKey ?? '2026',
    overrides.documentType ?? 'invoice',
    overrides.register ?? null,
    overrides.fiscalYearStartMonth ?? 1,
    overrides.createdAt ?? NOW,
    overrides.updatedAt ?? NOW,
  );
}

function routeFixture(overrides: Partial<SeriesRouteData> = {}): SeriesRouteData {
  return {
    connectionId: overrides.connectionId ?? 'conn-1',
    documentType: overrides.documentType ?? 'invoice',
    register: overrides.register ?? null,
    currency: overrides.currency ?? null,
    source: overrides.source ?? null,
    seriesId: overrides.seriesId ?? '11111111-1111-4111-8111-111111111111',
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function gapNoteFixture(overrides: Partial<NumberingGapNoteData> = {}): NumberingGapNoteData {
  return {
    id: overrides.id ?? 'note-1',
    seriesId: overrides.seriesId ?? '11111111-1111-4111-8111-111111111111',
    seq: overrides.seq ?? 42,
    documentNumber: overrides.documentNumber ?? 'FV/2026/00042',
    reason: overrides.reason ?? 'Abandoned draft',
    actorUserId: overrides.actorUserId ?? 'user-1',
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function auditFixture(overrides: Partial<SeriesAudit> = {}): SeriesAudit {
  return {
    seriesId: overrides.seriesId ?? '11111111-1111-4111-8111-111111111111',
    seriesName: overrides.seriesName ?? 'Sales invoices 2026',
    skippedInferenceApplied: overrides.skippedInferenceApplied ?? true,
    summary: overrides.summary ?? {
      issuedCount: 2,
      pendingCount: 0,
      abandonedCount: 1,
      skippedCount: 1,
      gapCount: 2,
      explainedGapCount: 1,
    },
    entries: overrides.entries ?? [
      {
        seq: 3,
        status: 'abandoned',
        isGap: true,
        documentNumber: 'FV/2026/00003',
        recordId: 'rec-3',
        orderId: 'ord-3',
        issuedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        note: gapNoteFixture({ seq: 3 }),
      },
      {
        seq: 4,
        status: 'skipped',
        isGap: true,
        documentNumber: null,
        recordId: null,
        orderId: null,
        issuedAt: null,
        createdAt: null,
        updatedAt: null,
        note: null,
      },
    ],
  };
}

describe('NumberingSeriesController', () => {
  let controller: NumberingSeriesController;
  let seriesService: jest.Mocked<INumberingSeriesService>;
  let auditService: jest.Mocked<INumberingAuditService>;

  beforeEach(async () => {
    seriesService = {
      createSeries: jest.fn(),
      getSeries: jest.fn(),
      listSeries: jest.fn(),
      listUnassignedSeries: jest.fn(),
      updateSeries: jest.fn(),
      findRoutesByConnectionId: jest.fn(),
      upsertRoute: jest.fn(),
      deleteRoute: jest.fn(),
      seriesExists: jest.fn(),
    };
    auditService = {
      getSeriesAudit: jest.fn(),
      recordGapNote: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NumberingSeriesController],
      providers: [
        { provide: NUMBERING_SERIES_SERVICE_TOKEN, useValue: seriesService },
        { provide: NUMBERING_AUDIT_SERVICE_TOKEN, useValue: auditService },
      ],
    }).compile();

    controller = moduleRef.get(NumberingSeriesController);
  });

  describe('createSeries', () => {
    it('should delegate to the service with documentType + register and map the response', async () => {
      seriesService.createSeries.mockResolvedValue(
        seriesFixture({ documentType: 'corrected', register: 'BR1' }),
      );
      const result = await controller.createSeries({
        name: 'Sales invoices 2026',
        pattern: 'FV/{YYYY}/{seq}',
        nextSeq: 1,
        seqPadding: 5,
        resetPolicy: 'yearly',
        documentType: 'corrected',
        register: 'BR1',
      });
      expect(seriesService.createSeries).toHaveBeenCalledWith({
        name: 'Sales invoices 2026',
        pattern: 'FV/{YYYY}/{seq}',
        nextSeq: 1,
        seqPadding: 5,
        resetPolicy: 'yearly',
        documentType: 'corrected',
        register: 'BR1',
      });
      expect(result.documentType).toBe('corrected');
      expect(result.register).toBe('BR1');
      expect(result.createdAt).toBe(NOW.toISOString());
    });

    it('should map InvalidNumberingPatternException to a 400 with the issue list', async () => {
      seriesService.createSeries.mockRejectedValue(
        new InvalidNumberingPatternException(['Pattern must contain the {seq} variable.']),
      );
      await expect(
        controller.createSeries({
          name: 'Bad',
          pattern: 'FV/{YYYY}',
          nextSeq: 1,
          seqPadding: 0,
          resetPolicy: 'yearly',
          documentType: 'invoice',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listSeries', () => {
    it('should pass a documentType/register filter through to the service', async () => {
      seriesService.listSeries.mockResolvedValue([seriesFixture()]);
      await controller.listSeries('invoice', 'BR1');
      expect(seriesService.listSeries).toHaveBeenCalledWith({
        documentType: 'invoice',
        register: 'BR1',
      });
    });

    it('should call the service with no filter when no query params are given', async () => {
      seriesService.listSeries.mockResolvedValue([seriesFixture()]);
      const result = await controller.listSeries();
      expect(seriesService.listSeries).toHaveBeenCalledWith(undefined);
      expect(result).toHaveLength(1);
    });
  });

  describe('listUnassignedSeries', () => {
    it('should derive lastIssuedSeq and a rendered preview when numbers were issued', async () => {
      seriesService.listUnassignedSeries.mockResolvedValue([seriesFixture({ nextSeq: 43 })]);
      const result = await controller.listUnassignedSeries();
      expect(result[0].lastIssuedSeq).toBe(42);
      expect(result[0].lastIssuedNumberPreview).toBe('FV/2026/00042');
    });

    it('should return null last-issued fields when nothing has been issued (nextSeq=1)', async () => {
      seriesService.listUnassignedSeries.mockResolvedValue([seriesFixture({ nextSeq: 1 })]);
      const result = await controller.listUnassignedSeries();
      expect(result[0].lastIssuedSeq).toBeNull();
      expect(result[0].lastIssuedNumberPreview).toBeNull();
    });
  });

  describe('getSeries', () => {
    it('should return the series when found', async () => {
      seriesService.getSeries.mockResolvedValue(seriesFixture());
      const result = await controller.getSeries('11111111-1111-4111-8111-111111111111');
      expect(result.id).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('should throw 404 when not found', async () => {
      seriesService.getSeries.mockResolvedValue(null);
      await expect(controller.getSeries('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateSeries', () => {
    it('should delegate the patch to the service and map the response', async () => {
      seriesService.updateSeries.mockResolvedValue(seriesFixture({ name: 'Renamed' }));
      const result = await controller.updateSeries('11111111-1111-4111-8111-111111111111', {
        name: 'Renamed',
      });
      expect(seriesService.updateSeries).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({ name: 'Renamed' }),
      );
      expect(result.name).toBe('Renamed');
    });

    it('should map InvoiceNumberingSeriesNotFoundException to 404', async () => {
      seriesService.updateSeries.mockRejectedValue(
        new InvoiceNumberingSeriesNotFoundException('11111111-1111-4111-8111-111111111111'),
      );
      await expect(
        controller.updateSeries('11111111-1111-4111-8111-111111111111', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should map InvalidNumberingPatternException to 400', async () => {
      seriesService.updateSeries.mockRejectedValue(
        new InvalidNumberingPatternException(['bad']),
      );
      await expect(
        controller.updateSeries('11111111-1111-4111-8111-111111111111', { resetPolicy: 'monthly' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should map DuplicateDocumentNumberException to 409', async () => {
      seriesService.updateSeries.mockRejectedValue(
        new DuplicateDocumentNumberException('conn-1', 'FV/2026/1'),
      );
      await expect(
        controller.updateSeries('11111111-1111-4111-8111-111111111111', { nextSeq: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('listRoutes', () => {
    it('should map the connection routes to response DTOs', async () => {
      seriesService.findRoutesByConnectionId.mockResolvedValue([
        routeFixture(),
        routeFixture({ documentType: 'corrected', register: 'BR1' }),
      ]);
      const result = await controller.listRoutes('conn-1');
      expect(result).toHaveLength(2);
      expect(result[1].documentType).toBe('corrected');
      expect(result[1].register).toBe('BR1');
      expect(result[0].createdAt).toBe(NOW.toISOString());
    });
  });

  describe('upsertRoute', () => {
    it('should upsert the route when the referenced series exists', async () => {
      seriesService.seriesExists.mockResolvedValue(true);
      seriesService.upsertRoute.mockResolvedValue(routeFixture({ documentType: 'corrected' }));
      const result = await controller.upsertRoute('conn-1', {
        documentType: 'corrected',
        seriesId: '11111111-1111-4111-8111-111111111111',
      });
      expect(seriesService.upsertRoute).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        documentType: 'corrected',
        register: null,
        currency: null,
        source: null,
        seriesId: '11111111-1111-4111-8111-111111111111',
      });
      expect(result.documentType).toBe('corrected');
    });

    it('should pass the register scope through', async () => {
      seriesService.seriesExists.mockResolvedValue(true);
      seriesService.upsertRoute.mockResolvedValue(routeFixture({ register: 'BR1' }));
      await controller.upsertRoute('conn-1', {
        documentType: 'invoice',
        register: 'BR1',
        seriesId: '11111111-1111-4111-8111-111111111111',
      });
      expect(seriesService.upsertRoute).toHaveBeenCalledWith(
        expect.objectContaining({ register: 'BR1' }),
      );
    });

    it('should 400 when the referenced series does not exist', async () => {
      seriesService.seriesExists.mockResolvedValue(false);
      await expect(
        controller.upsertRoute('conn-1', {
          documentType: 'invoice',
          seriesId: 'missing',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(seriesService.upsertRoute).not.toHaveBeenCalled();
    });
  });

  describe('deleteRoute', () => {
    it('should detach the route (no-op safe)', async () => {
      seriesService.deleteRoute.mockResolvedValue(undefined);
      await controller.deleteRoute('conn-1', { documentType: 'corrected' });
      expect(seriesService.deleteRoute).toHaveBeenCalledWith('conn-1', 'corrected', {
        register: null,
        currency: null,
        source: null,
      });
    });

    it('should pass the register / currency / source scope through (#1694)', async () => {
      seriesService.deleteRoute.mockResolvedValue(undefined);
      await controller.deleteRoute('conn-1', {
        documentType: 'invoice',
        register: 'BR1',
        currency: 'EUR',
        source: 'allegro',
      });
      expect(seriesService.deleteRoute).toHaveBeenCalledWith('conn-1', 'invoice', {
        register: 'BR1',
        currency: 'EUR',
        source: 'allegro',
      });
    });
  });

  describe('getSeriesAudit', () => {
    it('should return the audit read model with dates projected to ISO strings', async () => {
      auditService.getSeriesAudit.mockResolvedValue(auditFixture());
      const result = await controller.getSeriesAudit('11111111-1111-4111-8111-111111111111');
      expect(auditService.getSeriesAudit).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        { onlyGaps: false },
      );
      expect(result.summary.gapCount).toBe(2);
      expect(result.entries[0].createdAt).toBe(NOW.toISOString());
      expect(result.entries[0].note?.reason).toBe('Abandoned draft');
      expect(result.entries[1].createdAt).toBeNull();
    });

    it('should pass onlyGaps=true when the query flag is set', async () => {
      auditService.getSeriesAudit.mockResolvedValue(auditFixture());
      await controller.getSeriesAudit('11111111-1111-4111-8111-111111111111', 'true');
      expect(auditService.getSeriesAudit).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        { onlyGaps: true },
      );
    });

    it('should map InvoiceNumberingSeriesNotFoundException to 404', async () => {
      auditService.getSeriesAudit.mockRejectedValue(
        new InvoiceNumberingSeriesNotFoundException('missing'),
      );
      await expect(
        controller.getSeriesAudit('11111111-1111-4111-8111-111111111111'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('recordGapNote', () => {
    it('should record the explanation with the current user as actor', async () => {
      auditService.recordGapNote.mockResolvedValue(gapNoteFixture());
      const result = await controller.recordGapNote(
        '11111111-1111-4111-8111-111111111111',
        { seq: 42, reason: 'Abandoned draft' },
        ADMIN,
      );
      expect(auditService.recordGapNote).toHaveBeenCalledWith({
        seriesId: '11111111-1111-4111-8111-111111111111',
        seq: 42,
        documentNumber: null,
        reason: 'Abandoned draft',
        actorUserId: 'user-1',
      });
      expect(result.seq).toBe(42);
      expect(result.actorUserId).toBe('user-1');
    });

    it('should map NumberingGapNoteReasonRequiredException to 400', async () => {
      auditService.recordGapNote.mockRejectedValue(
        new NumberingGapNoteReasonRequiredException('11111111-1111-4111-8111-111111111111', 42),
      );
      await expect(
        controller.recordGapNote(
          '11111111-1111-4111-8111-111111111111',
          { seq: 42, reason: '   ' },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('role guards', () => {
    it('should gate write endpoints behind @Roles(admin) and leave reads open', () => {
      const admin = (method: string): unknown =>
        Reflect.getMetadata(
          ROLES_KEY,
          NumberingSeriesController.prototype[method as keyof NumberingSeriesController] as object,
        ) as unknown;
      expect(admin('createSeries')).toEqual(['admin']);
      expect(admin('updateSeries')).toEqual(['admin']);
      expect(admin('upsertRoute')).toEqual(['admin']);
      expect(admin('deleteRoute')).toEqual(['admin']);
      expect(admin('recordGapNote')).toEqual(['admin']);
      expect(admin('listSeries')).toBeUndefined();
      expect(admin('getSeries')).toBeUndefined();
      expect(admin('listUnassignedSeries')).toBeUndefined();
      expect(admin('listRoutes')).toBeUndefined();
      expect(admin('getSeriesAudit')).toBeUndefined();
    });
  });
});
