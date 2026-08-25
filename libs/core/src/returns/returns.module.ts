/**
 * Returns Module (#2327, ADR-060)
 *
 * Registers the two ORM entities, the repository behind its port token, the
 * #2328 application service behind `RETURNS_SERVICE_TOKEN`, and — since #2330 —
 * the two ingestion services: `ReturnIngestionService` (pass 1, discovery +
 * fan-out) and `ReturnStatusSyncService` (pass 2, the bounded lifecycle
 * re-read).
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
 * #2330 adds two more, both to reach the source: `returns -> integrations` (a
 * real module-graph edge — both ingestion services resolve the connection's
 * `OrderSource` adapter through `IIntegrationsService`) and `returns -> sync`
 * (likewise — the cursor seam, the job queue and the lock). Both are acyclic:
 * neither `IntegrationsModule` nor `SyncModule` imports this one.
 *
 * `returns -> orders` was type-only before #2330 and is now a real VALUE edge as
 * well, because the ingestion services import the `isReturnSourceReader` guard.
 * It creates NO module-graph edge in either direction — the guard is a plain
 * function with no DI — so `OrdersModule` is deliberately absent from `imports`
 * below, and adding it "for symmetry" would manufacture the very cycle the
 * one-way rule exists to prevent. Runtime-acyclic for the same reason it always
 * was: `orders`' only reference back to this context is an `import type`, which
 * erases at build time.
 *
 * `returns` is therefore still NOT registered as a zero-sibling-edge leaf in
 * `libs/core/src/__tests__/barrel-purity.spec.ts`: it now has four real outbound
 * edges rather than one, so the property that table asserts is further from
 * true, not closer.
 *
 * @module libs/core/src/returns
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { SyncModule } from '@openlinker/core/sync';
import { ReturnIngestionService } from './application/services/return-ingestion.service';
import { ReturnStatusSyncService } from './application/services/return-status-sync.service';
import { ReturnsService } from './application/services/returns.service';
import { ReturnOrmEntity } from './infrastructure/persistence/entities/return.orm-entity';
import { ReturnLineOrmEntity } from './infrastructure/persistence/entities/return-line.orm-entity';
import { ReturnRepository } from './infrastructure/persistence/repositories/return.repository';
import {
  RETURN_INGESTION_SERVICE_TOKEN,
  RETURN_REPOSITORY_TOKEN,
  RETURN_STATUS_SYNC_SERVICE_TOKEN,
  RETURNS_SERVICE_TOKEN,
} from './returns.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReturnOrmEntity, ReturnLineOrmEntity]),
    // #2328 order attribution: `IIdentifierMappingService.getInternalId`.
    // Acyclic — IdentifierMappingModule does not import ReturnsModule.
    IdentifierMappingModule,
    // #2330 ingestion: resolves the connection's `OrderSource` adapter and
    // narrows it to a `ReturnSourceReader`. Acyclic.
    IntegrationsModule,
    // #2330 ingestion: cursor seam, job queue and per-connection lock. Acyclic.
    SyncModule,
  ],
  providers: [
    ReturnRepository,
    { provide: RETURN_REPOSITORY_TOKEN, useExisting: ReturnRepository },
    ReturnsService,
    { provide: RETURNS_SERVICE_TOKEN, useExisting: ReturnsService },
    ReturnIngestionService,
    { provide: RETURN_INGESTION_SERVICE_TOKEN, useExisting: ReturnIngestionService },
    ReturnStatusSyncService,
    { provide: RETURN_STATUS_SYNC_SERVICE_TOKEN, useExisting: ReturnStatusSyncService },
  ],
  exports: [
    RETURN_REPOSITORY_TOKEN,
    RETURNS_SERVICE_TOKEN,
    RETURN_INGESTION_SERVICE_TOKEN,
    RETURN_STATUS_SYNC_SERVICE_TOKEN,
  ],
})
export class ReturnsModule {}
