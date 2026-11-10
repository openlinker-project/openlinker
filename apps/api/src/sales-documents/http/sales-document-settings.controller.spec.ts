import { BadRequestException } from '@nestjs/common';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  InvalidGiftDocumentFormError,
  type ISalesDocumentSettingsService,
} from '@openlinker/core/sales-documents';
import { SalesDocumentSettingsController } from './sales-document-settings.controller';

describe('SalesDocumentSettingsController', () => {
  let settings: jest.Mocked<ISalesDocumentSettingsService>;
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;
  let controller: SalesDocumentSettingsController;

  beforeEach(() => {
    settings = { getGiftDocumentForm: jest.fn(), setGiftDocumentForm: jest.fn() };
    integrations = { listCapabilityAdapters: jest.fn() } as never;
    controller = new SalesDocumentSettingsController(
      settings,
      integrations as unknown as IIntegrationsService
    );
  });

  it('should report the default and its source when nothing is saved', async () => {
    settings.getGiftDocumentForm.mockResolvedValue({
      form: 'technical-cent',
      unitPrice: null,
      source: 'default',
      updatedAt: null,
      updatedBy: null,
    });
    await expect(controller.get()).resolves.toMatchObject({
      giftDocumentForm: 'technical-cent',
      giftDocumentFormSource: 'default',
      updatedAt: null,
    });
  });

  it('should save the choice with the acting user', async () => {
    const updatedAt = new Date('2026-11-05T10:00:00Z');
    settings.setGiftDocumentForm.mockResolvedValue({
      form: 'priced-in',
      unitPrice: null,
      source: 'setting',
      updatedAt,
      updatedBy: 'u1',
    });
    const result = await controller.set({ giftDocumentForm: 'priced-in' }, { id: 'u1' } as never);
    expect(settings.setGiftDocumentForm).toHaveBeenCalledWith('priced-in', 'u1', null);
    expect(result.giftDocumentFormSource).toBe('setting');
  });

  it('should pass the custom-price amount through and report it', async () => {
    settings.setGiftDocumentForm.mockResolvedValue({
      form: 'custom-price',
      unitPrice: '4.50',
      source: 'setting',
      updatedAt: new Date('2026-11-05T10:00:00Z'),
      updatedBy: 'u1',
    });
    const result = await controller.set(
      { giftDocumentForm: 'custom-price', giftDocumentUnitPrice: '4.50' },
      { id: 'u1' } as never
    );
    expect(settings.setGiftDocumentForm).toHaveBeenCalledWith('custom-price', 'u1', '4.50');
    expect(result.giftDocumentUnitPrice).toBe('4.50');
  });

  it('should answer 400 for a form the service refuses', async () => {
    settings.setGiftDocumentForm.mockRejectedValue(new InvalidGiftDocumentFormError('x'));
    await expect(
      controller.set({ giftDocumentForm: 'omit' }, { id: 'u1' } as never)
    ).rejects.toThrow(BadRequestException);
  });

  it('should report each provider zero-line declaration and treat a receipt as refusing zero', async () => {
    integrations.listCapabilityAdapters.mockImplementation((({
      capability,
    }: {
      capability: string;
    }) =>
      Promise.resolve(
        capability === 'Invoicing'
          ? [
              {
                connectionId: 'a',
                connection: { name: 'KSeF', platformType: 'ksef' },
                adapter: { acceptsZeroValueLine: () => true },
              },
              { connectionId: 'b', connection: { name: 'X', platformType: 'x' }, adapter: {} },
            ]
          : [
              {
                connectionId: 'c',
                connection: { name: 'Receipts', platformType: 'eparagony' },
                adapter: {},
              },
            ]
      )) as never);
    const { providers } = await controller.documentProviders();
    expect(providers.map((p) => [p.connectionId, p.kind, p.acceptsZeroValueLine])).toEqual([
      ['a', 'invoice', true],
      ['b', 'invoice', null],
      ['c', 'fiscal-receipt', false],
    ]);
  });
});
