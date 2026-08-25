/**
 * Returns Read API Module
 *
 * REST reads over the return aggregate (#2334) — the sibling of
 * `ReturnActionsApiModule` (#2333), which owns the one return WRITE.
 *
 * Two modules on one route prefix rather than one, deliberately: the write
 * carries `@Roles('admin', 'operator')` and these reads do not, and the two
 * inject different services. See `ReturnsController`'s docblock for the full
 * argument. Both import the same `ReturnsModule`, so no provider is duplicated.
 *
 * @module apps/api/src/returns
 */
import { Module } from '@nestjs/common';
import { ReturnsModule } from '@openlinker/core/returns';
import { ReturnsController } from './http/returns.controller';

@Module({
  imports: [ReturnsModule],
  controllers: [ReturnsController],
})
export class ReturnsReadApiModule {}
