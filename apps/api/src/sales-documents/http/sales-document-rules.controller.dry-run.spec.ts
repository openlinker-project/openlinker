/**
 * SalesDocumentRulesController — dry-run route unit tests (#3191)
 *
 * @module apps/api/src/sales-documents/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID,
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  SalesDocumentInvalidConditionException,
} from '@openlinker/core/sales-documents';
import type { ISalesDocumentRulesService } from '@openlinker/core/sales-documents';

import { SalesDocumentRulesController } from './sales-document-rules.controller';
import { SalesDocumentCapabilityGuardService } from '../sales-document-capability-guard.service';
import type { DryRunSalesDocumentRuleDto } from './dto/dry-run-sales-document-rule.dto';

describe('SalesDocumentRulesController — dry-run (#3191)', () => {
  let controller: SalesDocumentRulesController;
  let service: { dryRunRule: jest.Mock };
  let capabilityGuard: { assertConnectionSupportsKind: jest.Mock };

  function baseRequest(overrides: Partial<DryRunSalesDocumentRuleDto> = {}): DryRunSalesDocumentRuleDto {
    return {
      country: 'PL',
      conditions: [{ field: 'orderCountry', op: 'eq', stringValue: 'PL' }],
      documentKind: 'fiscal-receipt',
      connectionId: 'conn-1',
      sampleOrder: {
        country: 'PL',
        totalGross: 100,
        currency: 'PLN',
      },
      ...overrides,
    } as DryRunSalesDocumentRuleDto;
  }

  beforeEach(async () => {
    service = { dryRunRule: jest.fn() };
    capabilityGuard = { assertConnectionSupportsKind: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesDocumentRulesController],
      providers: [
        {
          provide: SALES_DOCUMENT_RULES_SERVICE_TOKEN,
          useValue: service as unknown as ISalesDocumentRulesService,
        },
        {
          provide: SalesDocumentCapabilityGuardService,
          useValue: capabilityGuard,
        },
      ],
    }).compile();

    controller = module.get(SalesDocumentRulesController);
  });

  it('should never call the capability guard — a dry run persists nothing for it to protect', async () => {
    service.dryRunRule.mockResolvedValue({ kind: 'unresolved', reason: 'no-configuration-for-country' });

    await controller.dryRunRule(baseRequest());

    expect(capabilityGuard.assertConnectionSupportsKind).not.toHaveBeenCalled();
  });

  it('should project a matched decision, flagging the candidate rule via the sentinel id', async () => {
    service.dryRunRule.mockResolvedValue({
      kind: 'route',
      documentKind: 'fiscal-receipt',
      connectionId: 'conn-1',
      ruleId: SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID,
    });

    const result = await controller.dryRunRule(baseRequest());

    expect(result).toEqual({
      kind: 'route',
      documentKind: 'fiscal-receipt',
      connectionId: 'conn-1',
      matchedByCandidateRule: true,
    });
  });

  it('should report a route matched by an ALREADY-SAVED rule as not the candidate', async () => {
    service.dryRunRule.mockResolvedValue({
      kind: 'route',
      documentKind: 'invoice',
      connectionId: 'conn-existing',
      ruleId: 'a-real-persisted-rule-id',
    });

    const result = await controller.dryRunRule(baseRequest());

    expect(result.matchedByCandidateRule).toBe(false);
  });

  it('should project an unresolved decision with its reason', async () => {
    service.dryRunRule.mockResolvedValue({ kind: 'unresolved', reason: 'net-priced-order' });

    const result = await controller.dryRunRule(baseRequest());

    expect(result).toEqual({
      kind: 'unresolved',
      reason: 'net-priced-order',
      matchedByCandidateRule: false,
    });
  });

  it('should map an invalid-condition rejection to a 400', async () => {
    service.dryRunRule.mockRejectedValue(new SalesDocumentInvalidConditionException(0));

    await expect(controller.dryRunRule(baseRequest())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should pass the sample order through to the service untouched', async () => {
    service.dryRunRule.mockResolvedValue({ kind: 'unresolved', reason: 'no-configuration-for-country' });

    await controller.dryRunRule(
      baseRequest({
        sampleOrder: { country: 'DE', totalGross: 250.5, currency: 'EUR', buyerHasTaxId: true },
      }),
    );

    expect(service.dryRunRule).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'PL', documentKind: 'fiscal-receipt', connectionId: 'conn-1' }),
      { country: 'DE', totalGross: 250.5, currency: 'EUR', taxTreatment: undefined, buyerHasTaxId: true },
    );
  });
});
