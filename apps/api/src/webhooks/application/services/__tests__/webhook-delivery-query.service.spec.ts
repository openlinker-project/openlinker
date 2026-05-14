import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { WebhookDeliveryQueryService } from '../webhook-delivery-query.service';
import type { WebhookDeliveryRepositoryPort } from '@openlinker/core/webhooks';
import { WEBHOOK_DELIVERY_REPOSITORY_TOKEN } from '@openlinker/core/webhooks';

describe('WebhookDeliveryQueryService', () => {
  let service: WebhookDeliveryQueryService;
  let repo: jest.Mocked<WebhookDeliveryRepositoryPort>;

  beforeEach(async () => {
    repo = {
      upsert: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDeliveryQueryService,
        { provide: WEBHOOK_DELIVERY_REPOSITORY_TOKEN, useValue: repo },
      ],
    }).compile();
    service = module.get(WebhookDeliveryQueryService);
  });

  it('should delegate list to repository.findMany', async () => {
    repo.findMany.mockResolvedValue({ items: [], total: 0 });
    const result = await service.list({ provider: 'prestashop' }, { limit: 10, offset: 0 });
    expect(result).toEqual({ items: [], total: 0 });
    expect(repo.findMany).toHaveBeenCalledWith(
      { provider: 'prestashop' },
      { limit: 10, offset: 0 }
    );
  });

  it('should delegate getById to repository.findById', async () => {
    repo.findById.mockResolvedValue(null);
    const result = await service.getById('abc');
    expect(result).toBeNull();
    expect(repo.findById).toHaveBeenCalledWith('abc');
  });

  it('should propagate repository errors from list', async () => {
    repo.findMany.mockRejectedValue(new Error('DB connection lost'));
    await expect(service.list({}, { limit: 10, offset: 0 })).rejects.toThrow('DB connection lost');
  });

  it('should propagate repository errors from getById', async () => {
    repo.findById.mockRejectedValue(new Error('DB connection lost'));
    await expect(service.getById('abc')).rejects.toThrow('DB connection lost');
  });
});
