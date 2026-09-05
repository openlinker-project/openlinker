/**
 * Bench Work Controller (#2416, `W3b-3`, spec § 2.2)
 *
 * The one read the pack bench makes.
 *
 * ## Auth — the first route in the tree a `packer` is GRANTED
 *
 * `JwtAuthGuard` is global, so per the house convention this file declares no
 * redundant `@UseGuards`. `@Roles('admin', 'operator', 'packer')` narrows it,
 * and naming `packer` makes `packer-exclusion.spec.ts` fail until the route is
 * registered in that file's `PACKER_GRANTED_ROUTES` — which is the point of
 * that list, and which its docblock reserved for exactly this issue.
 *
 * Reviewed against #2413's stated principle — *a packer keeps the operational
 * reads a bench touches, is excluded from every register and from
 * configuration, and reaches the parcel through the work*. This read is scoped
 * to work routed to and accepted by OpenLinker's own packing executor, carries
 * one buyer name per row and no configuration at all, and writes nothing. It
 * qualifies.
 *
 * ## No query parameters, deliberately
 *
 * The scope is a property of the bench rather than of the request. A packer
 * must not be able to widen the read to another executor's work by editing a
 * query string, and no narrower one is needed: the bench's search field filters
 * rows the browser already holds, which is also why it can match a buyer's
 * surname without sending one to the server.
 *
 * @module apps/api/src/bench/http
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  BENCH_WORK_SERVICE_TOKEN,
  type IBenchWorkService,
} from '../application/interfaces/bench-work.service.interface';
import type { BenchWorkListView } from '../application/types/bench-work.types';
import { BenchWorkListResponseDto } from './dto/bench-work-response.dto';
import { Roles } from '../../auth/decorators/roles.decorator';

@ApiBearerAuth()
@ApiTags('bench')
@Controller('bench')
export class BenchWorkController {
  constructor(
    @Inject(BENCH_WORK_SERVICE_TOKEN)
    private readonly bench: IBenchWorkService
  ) {}

  @Get('work')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Packing work waiting at the bench',
    description:
      'Everything routed to OpenLinker’s own packing executor and accepted there, most urgent ' +
      'first. This is what routing assigned — not a list of every unpacked order, and never an ' +
      'order that goes out through a logistics provider. It reports nothing about whether the ' +
      'goods are on the shelf.',
  })
  @ApiResponse({ status: 200, type: BenchWorkListResponseDto })
  async listBenchWork(): Promise<BenchWorkListResponseDto> {
    return this.toDto(await this.bench.listBenchWork());
  }

  private toDto(view: BenchWorkListView): BenchWorkListResponseDto {
    // Field-by-field, never a spread — see the DTO module docblock.
    return {
      works: view.works.map((work) => ({
        workId: work.workId,
        version: work.version,
        orderId: work.orderId,
        orderReference: work.orderReference,
        buyerName: work.buyerName,
        dispatchByAt: work.dispatchByAt,
        parcelIndex: work.parcelIndex,
        parcelTotal: work.parcelTotal,
        lineCount: work.lineCount,
        unitsToVerify: work.unitsToVerify,
        state: work.state,
        holdReason: work.holdReason,
        holdPlacedAt: work.holdPlacedAt,
        expeditedAt: work.expeditedAt,
        supportedActions: [...work.supportedActions],
      })),
      executorName: view.executorName,
      routing: {
        ready: view.routing.ready,
        // `null` rather than an omitted key: the field is always present, so a
        // client reads the reason or reads an explicit absence — never
        // `undefined`, which #939 records as the shape that silently drops a
        // whole section on the way through a boundary schema.
        reason: view.routing.ready ? null : view.routing.reason,
      },
      total: view.total,
    };
  }
}
