/**
 * Return Actions API Module
 *
 * REST surface for the one return write (#2333). A sibling of
 * `CatalogTrustApiModule` — the same thin composition over a core context that
 * owns its own persistence.
 *
 * Named for the ACTIONS half deliberately: the returns read API (#2334) ships
 * concurrently and will bring its own module into this directory. Keeping the
 * two files and class names distinct makes that a textual merge.
 *
 * @module apps/api/src/returns
 */
import { Module } from '@nestjs/common';
import { ReturnsModule } from '@openlinker/core/returns';
import { ReturnActionsController } from './http/return-actions.controller';

@Module({
  imports: [ReturnsModule],
  controllers: [ReturnActionsController],
})
export class ReturnActionsApiModule {}
