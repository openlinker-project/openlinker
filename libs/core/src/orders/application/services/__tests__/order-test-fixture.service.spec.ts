/**
 * Order Test Fixture Service Tests
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import type { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared/logging';
import { TestFixturesDisabledException } from '../../../domain/exceptions/test-fixtures-disabled.exception';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import { OrderTestFixtureService } from '../order-test-fixture.service';

describe('OrderTestFixtureService', () => {
  let repository: jest.Mocked<Pick<OrderRecordRepositoryPort, 'stampPreRolloutEraForTesting'>>;
  let configService: jest.Mocked<ConfigService>;
  let warn: jest.SpyInstance;
  const originalNodeEnv = process.env.NODE_ENV;

  function buildService(): OrderTestFixtureService {
    return new OrderTestFixtureService(
      repository as unknown as OrderRecordRepositoryPort,
      configService
    );
  }

  beforeEach(() => {
    repository = { stampPreRolloutEraForTesting: jest.fn().mockResolvedValue(true) };
    configService = { get: jest.fn().mockReturnValue('false') } as unknown as jest.Mocked<
      ConfigService
    >;
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('markPreRolloutEraForTesting', () => {
    it('refuses with TestFixturesDisabledException when OL_ALLOW_TEST_FIXTURES is not set', async () => {
      const service = buildService();

      await expect(
        service.markPreRolloutEraForTesting('ol_order_a', 'ol_user_a')
      ).rejects.toBeInstanceOf(TestFixturesDisabledException);
      expect(repository.stampPreRolloutEraForTesting).not.toHaveBeenCalled();
    });

    it("refuses when OL_ALLOW_TEST_FIXTURES is set to a non-'true' value", async () => {
      configService.get.mockReturnValue('1');
      const service = buildService();

      await expect(
        service.markPreRolloutEraForTesting('ol_order_a', 'ol_user_a')
      ).rejects.toBeInstanceOf(TestFixturesDisabledException);
    });

    it('is case/whitespace tolerant on the gate value', async () => {
      configService.get.mockReturnValue('  TRUE  ');
      const service = buildService();

      await expect(
        service.markPreRolloutEraForTesting('ol_order_a', 'ol_user_a')
      ).resolves.toBe(true);
    });

    it('calls the repository and returns its answer when the gate is open', async () => {
      configService.get.mockReturnValue('true');
      repository.stampPreRolloutEraForTesting.mockResolvedValue(false);
      const service = buildService();

      await expect(
        service.markPreRolloutEraForTesting('ol_order_a', 'ol_user_a')
      ).resolves.toBe(false);
      expect(repository.stampPreRolloutEraForTesting).toHaveBeenCalledWith('ol_order_a');
    });

    it('logs at warn on a successful (non-throwing) call — an audit trail for a fixture action, including the actor', async () => {
      configService.get.mockReturnValue('true');
      const service = buildService();

      await service.markPreRolloutEraForTesting('ol_order_a', 'ol_user_a');

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ol_order_a')
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ol_user_a'));
    });

    it('refuses under NODE_ENV=production even when OL_ALLOW_TEST_FIXTURES is true', async () => {
      configService.get.mockReturnValue('true');
      process.env.NODE_ENV = 'production';
      const service = buildService();

      await expect(
        service.markPreRolloutEraForTesting('ol_order_a', 'ol_user_a')
      ).rejects.toBeInstanceOf(TestFixturesDisabledException);
      expect(repository.stampPreRolloutEraForTesting).not.toHaveBeenCalled();
    });
  });

  describe('assertTestFixturesAllowed', () => {
    it('throws without touching the repository when the gate is closed', () => {
      const service = buildService();

      expect(() => service.assertTestFixturesAllowed()).toThrow(TestFixturesDisabledException);
    });

    it('does not throw when the gate is open', () => {
      configService.get.mockReturnValue('true');
      const service = buildService();

      expect(() => service.assertTestFixturesAllowed()).not.toThrow();
    });
  });
});
