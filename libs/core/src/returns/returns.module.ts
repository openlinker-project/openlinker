/**
 * Returns Module (#2327, ADR-060)
 *
 * Registers the two ORM entities and the thin repository behind its port token.
 *
 * `imports: []` beyond `TypeOrmModule.forFeature` is deliberate: this slice has
 * no application service (#2328), no ingestion (#2329) and no read API (#2334),
 * so it needs no sibling context's providers. The context's only edge to a
 * sibling today is `returns -> orders`, for the `RefundReason` vocabulary off
 * the `@openlinker/core/orders/types` cycle-breaker sub-barrel — which carries
 * no `OrdersModule`, so no module-graph edge exists in either direction.
 *
 * `returns` is NOT registered as a zero-sibling-edge leaf in
 * `libs/core/src/__tests__/barrel-purity.spec.ts`: it has that real
 * `returns -> orders` edge, so the property the table asserts is simply not
 * true of it. If a later wave ever strips the edge, registering it is one line
 * in `ZERO_SIBLING_EDGE_LEAVES` with an empty allow-set.
 *
 * @module libs/core/src/returns
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReturnOrmEntity } from './infrastructure/persistence/entities/return.orm-entity';
import { ReturnLineOrmEntity } from './infrastructure/persistence/entities/return-line.orm-entity';
import { ReturnRepository } from './infrastructure/persistence/repositories/return.repository';
import { RETURN_REPOSITORY_TOKEN } from './returns.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([ReturnOrmEntity, ReturnLineOrmEntity])],
  providers: [
    ReturnRepository,
    { provide: RETURN_REPOSITORY_TOKEN, useExisting: ReturnRepository },
  ],
  exports: [RETURN_REPOSITORY_TOKEN],
})
export class ReturnsModule {}
