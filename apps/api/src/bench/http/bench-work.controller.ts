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
 * ## `Assigned to other packers` is admin/operator only (#3340, ADR-071)
 *
 * A packer's own row is dropped SERVER-SIDE for a row locked to somebody
 * else, never merely hidden by the frontend: it carries a buyer name off the
 * order snapshot, and `isClaimableByViewer` already refuses it, so a packer
 * has no use for it and every reason not to receive it. `supervises()` below
 * decides who keeps it, resolved from the caller's own permissions rather
 * than a request flag a packer could edit.
 *
 * @module apps/api/src/bench/http
 */
import { Controller, Get, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ROLE_PERMISSIONS } from '@openlinker/core/users';

import {
  BENCH_WORK_SERVICE_TOKEN,
  type IBenchWorkService,
} from '../application/interfaces/bench-work.service.interface';
import type { BenchClaimNextResultView } from '../application/types/bench-parcel.types';
import type {
  BenchMetricsView,
  BenchPackedTodayListView,
  BenchWorkListView,
} from '../application/types/bench-work.types';
import { toParcelResponseDto } from './dto/bench-parcel.mapper';
import { BenchClaimNextResultResponseDto } from './dto/bench-parcel-response.dto';
import {
  BenchMetricsResponseDto,
  BenchPackedTodayListResponseDto,
  BenchWorkListResponseDto,
} from './dto/bench-work-response.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';

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
  async listBenchWork(
    @CurrentUser() actor: AuthenticatedUser
  ): Promise<BenchWorkListResponseDto> {
    return this.toDto(await this.bench.listBenchWork(actor.id, this.supervises(actor)));
  }

  @Post('work/claim-next')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Take next task',
    description:
      'Server-picked "whatever\'s next" — the top eligible row from the SAME sorted, filtered ' +
      'worklist listBenchWork returns, claimed on the caller\'s behalf. `nothing-to-claim` is an ' +
      'ordinary outcome, not an error: the queue can legitimately have nothing this packer may ' +
      'take right now.',
  })
  @ApiResponse({ status: 201, type: BenchClaimNextResultResponseDto })
  @ApiResponse({ status: 401, description: 'A claim must name the packer' })
  async claimNext(
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BenchClaimNextResultResponseDto> {
    if (!user?.id) {
      throw new UnauthorizedException('A claim must name the packer');
    }
    return this.toClaimNextDto(await this.bench.claimNext(user.id));
  }

  @Get('work/packed-today')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Parcels this bench has closed today',
    description:
      "The 'Packed today' tab — newest-closed first, server's own day boundary (this product has " +
      'no per-bench timezone concept, exactly as it has no per-bench location).',
  })
  @ApiResponse({ status: 200, type: BenchPackedTodayListResponseDto })
  async listPackedToday(): Promise<BenchPackedTodayListResponseDto> {
    const { dayStart, dayEnd } = todayBounds(new Date());
    return this.toPackedTodayDto(await this.bench.listPackedToday(dayStart, dayEnd));
  }

  @Get('metrics')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'The bench metric row',
    description:
      "Packed-today count, its trend against the SAME elapsed portion of yesterday, and the " +
      "outstanding backlog across every connection routed to this bench's packing executor.",
  })
  @ApiResponse({ status: 200, type: BenchMetricsResponseDto })
  async getMetrics(): Promise<BenchMetricsResponseDto> {
    return this.toMetricsDto(await this.bench.getMetrics(new Date()));
  }

  /**
   * May this caller see work assigned to OTHER packers (#3340, ADR-071)?
   *
   * A PERMISSION test, not a role-name comparison — `packer` is deliberately
   * granted NO permissions at all (`ROLE_PERMISSIONS`, `role.types.ts`), so
   * testing for `orders:write` separates admin/operator from packer exactly as
   * a `role !== 'packer'` compare would, and additionally gives a future role
   * with no permissions the same narrow answer a new `packer`-shaped role
   * ought to get, rather than silently defaulting it to supervisory — the
   * `hasShipmentsWrite` precedent on `ShipmentController` /
   * `BenchDocumentsController` verbatim. `viewer` also lacks `orders:write` but
   * cannot reach this route at all (`@Roles('admin', 'operator', 'packer')`
   * above), so the two cases this needs to tell apart are covered.
   */
  private supervises(user: AuthenticatedUser): boolean {
    const permissions = ROLE_PERMISSIONS[user.role];
    return permissions?.includes('orders:write') ?? false;
  }

  private toPackedTodayDto(view: BenchPackedTodayListView): BenchPackedTodayListResponseDto {
    return {
      works: view.works.map((row) => ({
        workId: row.workId,
        orderReference: row.orderReference,
        buyerName: row.buyerName,
        parcelIndex: row.parcelIndex,
        parcelTotal: row.parcelTotal,
        closedAt: row.closedAt,
        packedByUserId: row.packedByUserId,
      })),
      total: view.total,
    };
  }

  private toMetricsDto(view: BenchMetricsView): BenchMetricsResponseDto {
    return {
      packedToday: view.packedToday,
      packedYesterday: view.packedYesterday,
      toPackAllBenches: view.toPackAllBenches,
    };
  }

  private toClaimNextDto(view: BenchClaimNextResultView): BenchClaimNextResultResponseDto {
    if (view.outcome === 'nothing-to-claim') {
      return { outcome: 'nothing-to-claim', parcel: null };
    }
    return { outcome: 'claimed', parcel: toParcelResponseDto(view.parcel) };
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
        assignmentState: work.assignmentState,
        claimable: work.claimable,
        completedAt: work.completedAt,
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

/**
 * The server's own local-day boundary for `date` (#3413).
 *
 * A pure function of its argument — never reads the system clock itself —
 * so the controller's own `new Date()` call is the ONE place either route
 * touches the clock, and a test can pin the day boundary by constructing a
 * fixed `Date` and calling this directly.
 */
function todayBounds(date: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}
