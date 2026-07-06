/**
 * Subiekt Controller Unit Tests (#1324)
 *
 * Verifies the owner-aware bank-accounts + cash-registers discovery routes:
 * mapped output for a Subiekt connection, rejection of a non-Subiekt
 * connection, and adapter-error propagation.
 *
 * @module apps/api/src/integrations/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SubiektController } from './subiekt.controller';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import type { SubiektInvoicingAdapter } from '@openlinker/integrations-subiekt';

describe('SubiektController', () => {
  let controller: SubiektController;
  let integrationsService: jest.Mocked<IIntegrationsService>;

  const bankAccounts = [
    {
      id: '5',
      accountNumber: 'PL61109010140000071219812874',
      bankName: 'Main account',
      isDefault: true,
      ownerPodmiotId: 1,
      ownerName: 'ACME Sp. z o.o.',
    },
    {
      id: '6',
      accountNumber: '',
      bankName: '',
      isDefault: false,
      ownerPodmiotId: 2,
      ownerName: null,
    },
  ];

  const cashRegisters = [
    { id: 100067, name: 'Kasa 1', symbol: 'K1', oddzialId: 100002 },
    { id: 100068, name: null, symbol: null, oddzialId: null },
  ];

  // A shaped test double satisfying the controller's structural narrow.
  const subiektAdapter = {
    listBankAccountsWithOwner: jest.fn().mockResolvedValue(bankAccounts),
    listCashRegisters: jest.fn().mockResolvedValue(cashRegisters),
  } as unknown as jest.Mocked<SubiektInvoicingAdapter>;

  beforeEach(async () => {
    const mockIntegrationsService = {
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      getCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubiektController],
      providers: [{ provide: INTEGRATIONS_SERVICE_TOKEN, useValue: mockIntegrationsService }],
    }).compile();

    controller = module.get<SubiektController>(SubiektController);
    integrationsService = module.get(INTEGRATIONS_SERVICE_TOKEN);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listBankAccounts', () => {
    it('should return the owner-aware bank-account list for a Subiekt connection', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(subiektAdapter);

      const result = await controller.listBankAccounts('conn-1');

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith('conn-1', 'Invoicing');
      expect(subiektAdapter.listBankAccountsWithOwner).toHaveBeenCalledTimes(1);
      expect(result).toEqual(bankAccounts);
      // Owner fields are preserved (distinct from the neutral InvoicingController route).
      expect(result[0].ownerPodmiotId).toBe(1);
      expect(result[1].ownerName).toBeNull();
    });

    it('should throw BadRequestException when the connection is not a Subiekt one', async () => {
      // A non-Subiekt Invoicing adapter lacks the discovery methods.
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        issueInvoice: jest.fn(),
      } as never);

      await expect(controller.listBankAccounts('conn-x')).rejects.toThrow(BadRequestException);
      await expect(controller.listBankAccounts('conn-x')).rejects.toThrow(
        'not a Subiekt Invoicing connection',
      );
    });

    it('should propagate adapter errors', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(subiektAdapter);
      subiektAdapter.listBankAccountsWithOwner.mockRejectedValueOnce(new Error('bridge unreachable'));

      await expect(controller.listBankAccounts('conn-1')).rejects.toThrow('bridge unreachable');
    });
  });

  describe('listCashRegisters', () => {
    it('should return the cash-register list for a Subiekt connection', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(subiektAdapter);

      const result = await controller.listCashRegisters('conn-1');

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith('conn-1', 'Invoicing');
      expect(subiektAdapter.listCashRegisters).toHaveBeenCalledTimes(1);
      expect(result).toEqual(cashRegisters);
      // null name/symbol/oddzialId degrade gracefully.
      expect(result[1].name).toBeNull();
      expect(result[1].oddzialId).toBeNull();
    });

    it('should throw BadRequestException when the connection is not a Subiekt one', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        issueInvoice: jest.fn(),
      } as never);

      await expect(controller.listCashRegisters('conn-x')).rejects.toThrow(BadRequestException);
    });

    it('should propagate adapter errors', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue(subiektAdapter);
      subiektAdapter.listCashRegisters.mockRejectedValueOnce(new Error('bridge timeout'));

      await expect(controller.listCashRegisters('conn-1')).rejects.toThrow('bridge timeout');
    });
  });
});
