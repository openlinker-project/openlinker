import { InvalidGiftDocumentFormError } from '../../domain/exceptions/invalid-gift-document-form.error';
import type { SalesDocumentSettingRepositoryPort } from '../../domain/ports/sales-document-setting-repository.port';
import { SalesDocumentSettingsService } from './sales-document-settings.service';

describe('SalesDocumentSettingsService', () => {
  let repository: jest.Mocked<SalesDocumentSettingRepositoryPort>;
  let service: SalesDocumentSettingsService;
  const now = new Date('2026-11-05T10:00:00Z');

  beforeEach(() => {
    repository = { findSetting: jest.fn(), upsertGiftDocumentForm: jest.fn() };
    service = new SalesDocumentSettingsService(repository);
  });

  it('should resolve technical-cent from the code default when no row exists', async () => {
    repository.findSetting.mockResolvedValue(null);
    await expect(service.getGiftDocumentForm()).resolves.toEqual({
      form: 'technical-cent',
      unitPrice: null,
      source: 'default',
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('should resolve the code default when the row is NULL or holds an unrecognised value', async () => {
    for (const stored of [null, 'free', 'internal-record']) {
      repository.findSetting.mockResolvedValue({ giftDocumentForm: stored, giftDocumentUnitPrice: null, updatedAt: now, updatedBy: null });
      expect((await service.getGiftDocumentForm()).source).toBe('default');
    }
  });

  it('should report a saved choice as a setting', async () => {
    repository.findSetting.mockResolvedValue({ giftDocumentForm: 'omit', giftDocumentUnitPrice: null, updatedAt: now, updatedBy: 'u1' });
    await expect(service.getGiftDocumentForm()).resolves.toMatchObject({ form: 'omit', source: 'setting' });
  });

  it('should save an offered form and refuse one that is not', async () => {
    repository.upsertGiftDocumentForm.mockResolvedValue({
      giftDocumentForm: 'show-zero',
      giftDocumentUnitPrice: null,
      updatedAt: now,
      updatedBy: 'u1',
    });
    await expect(service.setGiftDocumentForm('show-zero', 'u1')).resolves.toMatchObject({
      form: 'show-zero',
      source: 'setting',
    });
    await expect(service.setGiftDocumentForm('internal-record', 'u1')).rejects.toThrow(
      InvalidGiftDocumentFormError,
    );
    expect(repository.upsertGiftDocumentForm).toHaveBeenCalledTimes(1);
  });

  it('should save custom-price with its amount, drop the amount for other forms, and refuse a missing or bad one', async () => {
    repository.upsertGiftDocumentForm.mockResolvedValue({
      giftDocumentForm: 'custom-price',
      giftDocumentUnitPrice: '4.5',
      updatedAt: now,
      updatedBy: 'u1',
    });
    await expect(service.setGiftDocumentForm('custom-price', 'u1', '4.5')).resolves.toMatchObject({
      form: 'custom-price',
      unitPrice: '4.5',
    });
    expect(repository.upsertGiftDocumentForm).toHaveBeenLastCalledWith('custom-price', '4.5', 'u1');
    await service.setGiftDocumentForm('omit', 'u1', '9').catch(() => undefined);
    expect(repository.upsertGiftDocumentForm).toHaveBeenLastCalledWith('omit', null, 'u1');
    for (const bad of [undefined, null, '0', '1.234']) {
      await expect(service.setGiftDocumentForm('custom-price', 'u1', bad)).rejects.toThrow(
        InvalidGiftDocumentFormError,
      );
    }
  });

  it('should resolve the code default when a saved custom-price has no usable amount', async () => {
    repository.findSetting.mockResolvedValue({
      giftDocumentForm: 'custom-price',
      giftDocumentUnitPrice: null,
      updatedAt: now,
      updatedBy: null,
    });
    expect((await service.getGiftDocumentForm()).source).toBe('default');
    repository.findSetting.mockResolvedValue({
      giftDocumentForm: 'custom-price',
      giftDocumentUnitPrice: '6',
      updatedAt: now,
      updatedBy: null,
    });
    await expect(service.getGiftDocumentForm()).resolves.toMatchObject({
      form: 'custom-price',
      unitPrice: '6',
      source: 'setting',
    });
  });
});
