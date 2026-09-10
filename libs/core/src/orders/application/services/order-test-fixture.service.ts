/**
 * Order Test Fixture Service
 *
 * Implements {@link IOrderTestFixtureService} — the narrow, double-gated
 * (role + env) write seam for analytics states no real ingestion flow can
 * ever produce (#2855).
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderTestFixtureService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared/logging';
import type { IOrderTestFixtureService } from '../interfaces/order-test-fixture.service.interface';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { TestFixturesDisabledException } from '../../domain/exceptions/test-fixtures-disabled.exception';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../orders.tokens';

const ALLOW_TEST_FIXTURES_ENV_VAR = 'OL_ALLOW_TEST_FIXTURES';

@Injectable()
export class OrderTestFixtureService implements IOrderTestFixtureService {
  private readonly logger = new Logger(OrderTestFixtureService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly orderRecordRepository: OrderRecordRepositoryPort,
    private readonly configService: ConfigService
  ) {}

  async markPreRolloutEraForTesting(internalOrderId: string): Promise<boolean> {
    this.assertTestFixturesAllowed();

    const applied = await this.orderRecordRepository.stampPreRolloutEraForTesting(internalOrderId);
    this.logger.warn(
      `Test fixture: stamped taxRateEra='pre-rollout' on order ${internalOrderId} (applied=${applied})`
    );
    return applied;
  }

  private assertTestFixturesAllowed(): void {
    const raw = this.configService.get<string>(ALLOW_TEST_FIXTURES_ENV_VAR, 'false');
    if (raw.trim().toLowerCase() !== 'true') {
      throw new TestFixturesDisabledException();
    }
  }
}
