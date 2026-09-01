/**
 * Sales-Document Templates Controller Specs (#2529)
 *
 * @module apps/api/src/sales-documents/http
 */
import { NotFoundException } from '@nestjs/common';
import type { ISalesDocumentRulesService } from '@openlinker/core/sales-documents';
import { SalesDocumentTemplatesController } from './sales-document-templates.controller';
import type { SalesDocumentCapabilityGuardService } from '../sales-document-capability-guard.service';

describe('SalesDocumentTemplatesController', () => {
  let service: jest.Mocked<Pick<ISalesDocumentRulesService, 'createRule'>>;
  let capabilityGuard: jest.Mocked<Pick<SalesDocumentCapabilityGuardService, 'assertConnectionSupportsKind'>>;
  let controller: SalesDocumentTemplatesController;

  beforeEach(() => {
    service = { createRule: jest.fn() };
    capabilityGuard = { assertConnectionSupportsKind: jest.fn().mockResolvedValue(undefined) };
    controller = new SalesDocumentTemplatesController(
      service as unknown as ISalesDocumentRulesService,
      capabilityGuard as unknown as SalesDocumentCapabilityGuardService,
    );
  });

  describe('listTemplates', () => {
    it('should return only markets with researched guidance when listed', () => {
      expect(controller.listTemplates()).toEqual({
        countries: [{ country: 'PL', sourceLabel: 'ksef.podatki.gov.pl', sourceUrl: 'https://ksef.podatki.gov.pl/' }],
      });
    });

    it('should create nothing when the catalogue is listed', () => {
      controller.listTemplates();
      expect(service.createRule).not.toHaveBeenCalled();
    });
  });

  describe('getTemplate', () => {
    it('should report 404 when the country has no curated template', () => {
      expect(() => controller.getTemplate('DE')).toThrow(NotFoundException);
    });

    it('should flag the rules that condition on a buyer tax id when Poland is previewed', () => {
      const template = controller.getTemplate('PL');
      expect(template.country).toBe('PL');
      expect(template.rules.every((rule) => rule.usesBuyerHasTaxId)).toBe(true);
    });
  });

  describe('adoptTemplate', () => {
    it('should reject adoption when the country has no curated template', async () => {
      await expect(controller.adoptTemplate('DE', { selections: [] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(service.createRule).not.toHaveBeenCalled();
    });
  });
});
