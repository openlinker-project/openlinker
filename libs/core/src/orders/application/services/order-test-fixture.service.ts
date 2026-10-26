/**
 * Order Test Fixture Service
 *
 * Implements {@link IOrderTestFixtureService} — the narrow, triple-gated
 * (role + env + NODE_ENV) write seam for analytics states no real ingestion
 * flow can ever produce (#2855).
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

  async markPreRolloutEraForTesting(
    internalOrderId: string,
    actorUserId: string
  ): Promise<boolean> {
    this.assertTestFixturesAllowed();

    const applied = await this.orderRecordRepository.stampPreRolloutEraForTesting(internalOrderId);
    this.logger.warn(
      `Test fixture: stamped taxRateEra='pre-rollout' on order ${internalOrderId} ` +
        `(applied=${applied}, actor=${actorUserId})`
    );
    return applied;
  }

  assertTestFixturesAllowed(): void {
    // Fail-closed under NODE_ENV=production regardless of the env var, mirroring
    // credentials-resolver.service.ts's dev/test-only gate (#709) — a copy-pasted
    // .env that carries OL_ALLOW_TEST_FIXTURES=true into production must not be
    // the only thing standing between a real order and this write.
    if (process.env.NODE_ENV === 'production') {
      throw new TestFixturesDisabledException();
    }

    // `get<string>` is a type ASSERTION, not a guarantee: ConfigService also
    // resolves from `load:` factories, which are not type-constrained, so a
    // non-string value would make a bare `raw.trim()` throw and turn the
    // modelled 403 into a 500. Coercing keeps the refusal the documented one.
    //
    // One value coerces the other way and it is intended: a real boolean
    // `true` renders as `'true'` and OPENS the gate, because a factory
    // returning it is an operator saying the fixtures are on. Refusing it
    // would be fail-closed in the pedantic sense only — the unconditional
    // NODE_ENV check above is what makes this unreachable in production.
    const raw = String(this.configService.get(ALLOW_TEST_FIXTURES_ENV_VAR) ?? 'false');
    if (raw.trim().toLowerCase() !== 'true') {
      throw new TestFixturesDisabledException();
    }
  }
}
