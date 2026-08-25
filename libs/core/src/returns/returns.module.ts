/**
 * Returns Module (#2327, ADR-060)
 *
 * Registers the two ORM entities, the repository behind its port token, and —
 * since #2328 — the application service behind `RETURNS_SERVICE_TOKEN`.
 *
 * `RETURN_REPOSITORY_TOKEN` stays exported for the host graph, but a SIBLING
 * CONTEXT must reach this aggregate through `IReturnsService`, never the
 * repository port (`docs/architecture-overview.md § Cross-context dependencies
 * in core`). That rule has teeth here: `orders` must never import `returns`
 * back, because a return-shaped read on an orders service would close a CJS
 * module-load cycle. The edge runs one way.
 *
 * ## The context now has TWO outbound edges, not one
 *
 * `returns -> orders` remains type-only, for the `RefundReason` vocabulary off
 * the `@openlinker/core/orders/types` cycle-breaker sub-barrel — which carries
 * no `OrdersModule`, so it creates no module-graph edge in either direction.
 *
 * `returns -> identifier-mapping` is NEW with #2328 and is a real module-graph
 * edge: `ReturnsService` resolves a source-native order id to an OL internal one
 * through `IIdentifierMappingService`, so `IdentifierMappingModule` is imported
 * here. Acyclic — `IdentifierMappingModule` is the tree's infrastructure spine
 * and depends on no domain context, least of all this one.
 *
 * `returns` is therefore still NOT registered as a zero-sibling-edge leaf in
 * `libs/core/src/__tests__/barrel-purity.spec.ts`: it now has two real outbound
 * edges rather than one, so the property that table asserts is further from
 * true, not closer.
 *
 * @module libs/core/src/returns
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { ReturnsService } from './application/services/returns.service';
import { ReturnOrmEntity } from './infrastructure/persistence/entities/return.orm-entity';
import { ReturnLineOrmEntity } from './infrastructure/persistence/entities/return-line.orm-entity';
import { ReturnRepository } from './infrastructure/persistence/repositories/return.repository';
import { RETURN_REPOSITORY_TOKEN, RETURNS_SERVICE_TOKEN } from './returns.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReturnOrmEntity, ReturnLineOrmEntity]),
    // #2328 order attribution: `IIdentifierMappingService.getInternalId`.
    // Acyclic — IdentifierMappingModule does not import ReturnsModule.
    IdentifierMappingModule,
  ],
  providers: [
    ReturnRepository,
    { provide: RETURN_REPOSITORY_TOKEN, useExisting: ReturnRepository },
    ReturnsService,
    { provide: RETURNS_SERVICE_TOKEN, useExisting: ReturnsService },
  ],
  exports: [RETURN_REPOSITORY_TOKEN, RETURNS_SERVICE_TOKEN],
})
export class ReturnsModule {}
