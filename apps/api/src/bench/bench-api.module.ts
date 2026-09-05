/**
 * Bench API Module (#2416, `W3b-3`; widened by #2418, `W3b-5`)
 *
 * The HTTP surface for the pack bench: the work list, one parcel, and the paper
 * that belongs with it.
 *
 * The composition lives here rather than in `libs/core` because every one of
 * these reads joins `fulfillment` to a sibling context — `orders` for the
 * reference and buyer name, `products` for what a packer matches against the
 * shelf label, `invoicing` for the document, `shipping` for the label — and
 * `libs/core/src/fulfillment` is a registered zero-sibling-edge leaf that may
 * not read any of them (ADR-053). The `FulfillmentAuthorityApiModule` (#2353)
 * shape. **This adds no core cross-context edge and spends no allow-list
 * entry.**
 *
 * Named `BenchApiModule` for the reason `FulfillmentApiModule` states: an
 * unqualified `BenchModule` would collide with any future core-side name and is
 * a trap for the next reader.
 *
 * @module apps/api/src/bench
 */
import { Module } from '@nestjs/common';
import { FulfillmentModule as CoreFulfillmentModule } from '@openlinker/core/fulfillment';
import { InvoicingModule } from '@openlinker/core/invoicing';
import { OrdersModule } from '@openlinker/core/orders';
import { ProductsModule } from '@openlinker/core/products';
import { ShippingModule } from '@openlinker/core/shipping';

import { IntegrationsModule } from '../integrations/integrations.module';
import { BENCH_DOCUMENTS_SERVICE_TOKEN } from './application/interfaces/bench-documents.service.interface';
import { BENCH_PARCEL_SERVICE_TOKEN } from './application/interfaces/bench-parcel.service.interface';
import { BENCH_WORK_SERVICE_TOKEN } from './application/interfaces/bench-work.service.interface';
import { BenchDocumentsService } from './application/services/bench-documents.service';
import { BenchExecutorResolver } from './application/services/bench-executor.resolver';
import { BenchParcelService } from './application/services/bench-parcel.service';
import { BenchWorkService } from './application/services/bench-work.service';
import { BenchDocumentsController } from './http/bench-documents.controller';
import { BenchParcelController } from './http/bench-parcel.controller';
import { BenchWorkController } from './http/bench-work.controller';

@Module({
  imports: [
    CoreFulfillmentModule,
    OrdersModule,
    ProductsModule,
    InvoicingModule,
    ShippingModule,
    IntegrationsModule,
  ],
  controllers: [BenchWorkController, BenchParcelController, BenchDocumentsController],
  providers: [
    // Shared by all three surfaces — story D2's "assigned to OpenLinker's own
    // packing executor" half, resolved once rather than restated per service.
    BenchExecutorResolver,
    BenchWorkService,
    { provide: BENCH_WORK_SERVICE_TOKEN, useExisting: BenchWorkService },
    BenchParcelService,
    { provide: BENCH_PARCEL_SERVICE_TOKEN, useExisting: BenchParcelService },
    BenchDocumentsService,
    { provide: BENCH_DOCUMENTS_SERVICE_TOKEN, useExisting: BenchDocumentsService },
  ],
})
export class BenchApiModule {}
