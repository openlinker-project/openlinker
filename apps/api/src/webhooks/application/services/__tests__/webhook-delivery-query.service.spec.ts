import { Test, TestingModule } from '@nestjs/testing';
import { WebhookDeliveryQueryService } from '../webhook-delivery-query.service';
import {
  WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
  WebhookDeliveryRepositoryPort,
} from '@openlinker/core/webhooks';

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
    const result = await service.list(
      { provider: 'prestashop' },
      { limit: 10, offset: 0 },
    );
    expect(result).toEqual({ items: [], total: 0 });
    expect(repo.findMany).toHaveBeenCalledWith(
      { provider: 'prestashop' },
      { limit: 10, offset: 0 },
    );
  });

  it('should delegate getById to repository.findById', async () => {
    repo.findById.mockResolvedValue(null);
    const result = await service.getById('abc');
    expect(result).toBeNull();
    expect(repo.findById).toHaveBeenCalledWith('abc');
  });
});
