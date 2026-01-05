/**
 * Webhook Dedup Service Unit Tests
 *
 * @module apps/api/src/webhooks/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { RedisClientType } from 'redis';
import { WebhookDedupService } from './webhook-dedup.service';

describe('WebhookDedupService', () => {
  let service: WebhookDedupService;
  let redisClient: jest.Mocked<RedisClientType>;

  beforeEach(async () => {
    const mockRedisClient = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDedupService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedisClient,
        },
      ],
    }).compile();

    service = module.get<WebhookDedupService>(WebhookDedupService);
    redisClient = module.get('REDIS_CLIENT');
  });

  describe('markProcessing', () => {
    it('should mark new event as processing', async () => {
      redisClient.set.mockResolvedValue('OK');

      const result = await service.markProcessing('prestashop', 'conn-123', 'event-456');

      expect(result).toBe(true);
      expect(redisClient.set).toHaveBeenCalledWith(
        'webhook:prestashop:conn-123:event-456',
        'processing',
        { NX: true, EX: 60 },
      );
    });

    it('should return false for duplicate event', async () => {
      redisClient.set.mockResolvedValue(null);
      redisClient.get.mockResolvedValue('processing');

      const result = await service.markProcessing('prestashop', 'conn-123', 'event-456');

      expect(result).toBe(false);
    });

    it('should return false for already done event', async () => {
      redisClient.set.mockResolvedValue(null);
      redisClient.get.mockResolvedValue('done');

      const result = await service.markProcessing('prestashop', 'conn-123', 'event-456');

      expect(result).toBe(false);
    });
  });

  describe('markDone', () => {
    it('should mark event as done', async () => {
      redisClient.set.mockResolvedValue('OK');

      await service.markDone('prestashop', 'conn-123', 'event-456');

      expect(redisClient.set).toHaveBeenCalledWith(
        'webhook:prestashop:conn-123:event-456',
        'done',
        { XX: true, EX: 604800 },
      );
    });

    it('should handle missing key gracefully', async () => {
      redisClient.set.mockResolvedValue(null);
      redisClient.set.mockResolvedValueOnce(null).mockResolvedValueOnce('OK');

      await service.markDone('prestashop', 'conn-123', 'event-456');

      // Should try to set without XX if key doesn't exist
      expect(redisClient.set).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearProcessing', () => {
    it('should clear processing marker', async () => {
      redisClient.del.mockResolvedValue(1);

      await service.clearProcessing('prestashop', 'conn-123', 'event-456');

      expect(redisClient.del).toHaveBeenCalledWith('webhook:prestashop:conn-123:event-456');
    });
  });
});




