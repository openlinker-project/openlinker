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
      source: 'default',
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('should resolve the code default when the row is NULL or holds an unrecognised value', async () => {
    for (const stored of [null, 'free', 'internal-record']) {
      repository.findSetting.mockResolvedValue({ giftDocumentForm: stored, updatedAt: now, updatedBy: null });
      expect((await service.getGiftDocumentForm()).source).toBe('default');
    }
  });

  it('should report a saved choice as a setting', async () => {
    repository.findSetting.mockResolvedValue({ giftDocumentForm: 'omit', updatedAt: now, updatedBy: 'u1' });
    await expect(service.getGiftDocumentForm()).resolves.toMatchObject({ form: 'omit', source: 'setting' });
  });

  it('should save an offered form and refuse one that is not', async () => {
    repository.upsertGiftDocumentForm.mockResolvedValue({
      giftDocumentForm: 'show-zero',
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
});
