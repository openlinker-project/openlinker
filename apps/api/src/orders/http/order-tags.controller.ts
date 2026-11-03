/**
 * Order Tags Controller (#3532, D34)
 *
 * The workspace tag vocabulary and its assignment to orders. Reads (`GET
 * /order-tags`) are open to every order-register role — a tag name and
 * color carry no PII and the filter/picker needs them for every role that
 * can see `/orders`. Vocabulary WRITES follow D34 exactly: admins and
 * operators may create a tag (from the picker); rename/recolor/delete stay
 * `@Roles('admin')`, matching "the Settings tag manager stays admin only".
 * Assignment (which orders carry which tag) is `admin`/`operator`, mirroring
 * every other `/orders` write.
 *
 * @module apps/api/src/orders/http
 */
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_TAG_SERVICE_TOKEN,
  OrderTagLimitReachedError,
  OrderTagNotFoundError,
  type IOrderRecordService,
  type IOrderTagService,
  type OrderTagWithCount,
} from '@openlinker/core/orders';
import {
  CreateOrderTagDto,
  UpdateOrderTagDto,
  BulkAssignOrderTagDto,
  BulkRemoveOrderTagDto,
} from './dto/create-order-tag.dto';
import type {
  BulkOrderTagResultDto} from './dto/order-tag-response.dto';
import {
  OrderTagResponseDto,
  BulkAssignOrderTagResponseDto,
  BulkRemoveOrderTagResponseDto,
} from './dto/order-tag-response.dto';
import { dedupeOrderIds, unexpectedRowFailure } from './bulk-row-result';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('order-tags')
export class OrderTagsController {
  private readonly logger = new Logger(OrderTagsController.name);

  constructor(
    @Inject(ORDER_TAG_SERVICE_TOKEN)
    private readonly service: IOrderTagService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The workspace tag vocabulary, each with its live order count.' })
  @ApiResponse({ status: 200, type: [OrderTagResponseDto] })
  async list(): Promise<OrderTagResponseDto[]> {
    const tags = await this.service.listAll();
    return tags.map((tag) => this.toDto(tag));
  }

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a tag (D34: admin or operator, from the picker). Refused past the workspace ' +
      'limit of 50 with a named reason.',
  })
  @ApiResponse({ status: 201, type: OrderTagResponseDto })
  @ApiResponse({ status: 409, description: 'Workspace tag limit reached.' })
  async create(@Body() dto: CreateOrderTagDto): Promise<OrderTagResponseDto> {
    try {
      const tag = await this.service.create(dto.name, dto.color);
      return this.toDto({ ...tag, orderCount: 0 });
    } catch (error) {
      if (error instanceof OrderTagLimitReachedError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Roles('admin')
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rename or recolor a tag (admin only — the Settings tag manager).' })
  @ApiResponse({ status: 200, type: OrderTagResponseDto })
  @ApiResponse({ status: 404, description: 'No such tag.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrderTagDto
  ): Promise<OrderTagResponseDto> {
    try {
      await this.service.update(id, dto);
    } catch (error) {
      throw this.mapNotFound(error, id);
    }
    // Re-read WITH the count — `update` returns the bare tag, and the Settings
    // page renders the count beside the fields it just changed.
    const all = await this.service.listAll();
    const withCount = all.find((t) => t.id === id);
    if (!withCount) {
      throw new NotFoundException(`Order tag not found: ${id}`);
    }
    return this.toDto(withCount);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a tag (admin only) and every order assignment naming it.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'No such tag.' })
  async delete(@Param('id') id: string): Promise<void> {
    try {
      await this.service.delete(id);
    } catch (error) {
      throw this.mapNotFound(error, id);
    }
  }

  @Roles('admin', 'operator')
  @Post(':tagId/bulk-assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Assign one tag to every named order (bulk action bar). Idempotent — an order that ' +
      'already carries it is reported in `alreadyTagged`, not re-assigned.',
  })
  @ApiResponse({ status: 200, type: BulkAssignOrderTagResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (more than 100 order ids)' })
  @ApiResponse({ status: 404, description: 'No such tag.' })
  async bulkAssign(
    @Param('tagId') tagId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkAssignOrderTagDto
  ): Promise<BulkAssignOrderTagResponseDto> {
    const orderIds = dedupeOrderIds(dto.orderIds);
    try {
      // tag_assignments has no FK to the order, so an unknown id would be written as a phantom row.
      const known = new Set(
        (await this.orderRecordService.findByIds(orderIds)).map((o) => o.internalOrderId)
      );
      const knownIds = orderIds.filter((id) => known.has(id));
      const result = await this.service.bulkAssign(tagId, knownIds, user.id);
      const added = new Set(result.addedOrderIds);
      const results: BulkOrderTagResultDto[] = orderIds.map((orderId) =>
        known.has(orderId)
          ? { orderId, outcome: added.has(orderId) ? 'added' : 'already-tagged' }
          : { orderId, outcome: 'failed', code: 'ORDER_NOT_FOUND', reason: 'Order not found.' }
      );
      return {
        tagId,
        added: result.added,
        alreadyTagged: result.alreadyTagged,
        failed: orderIds.length - knownIds.length,
        results,
      };
    } catch (error) {
      if (error instanceof OrderTagNotFoundError) {
        throw this.mapNotFound(error, tagId);
      }
      const results = this.failAll(orderIds, 'bulk tag assign', error);
      return { tagId, added: 0, alreadyTagged: 0, failed: results.length, results };
    }
  }

  @Roles('admin', 'operator')
  @Post(':tagId/bulk-remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Remove one tag from every named order (bulk action bar). Idempotent - an order that ' +
      'does not carry it (including an id that names no order) is reported in `notTagged`. At most 100 order ids.',
  })
  @ApiResponse({ status: 200, type: BulkRemoveOrderTagResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (more than 100 order ids)' })
  @ApiResponse({ status: 404, description: 'No such tag.' })
  async bulkRemove(
    @Param('tagId') tagId: string,
    @Body() dto: BulkRemoveOrderTagDto
  ): Promise<BulkRemoveOrderTagResponseDto> {
    const orderIds = dedupeOrderIds(dto.orderIds);
    try {
      const result = await this.service.bulkUnassign(tagId, orderIds);
      const removed = new Set(result.removedOrderIds);
      return {
        tagId,
        removed: result.removedOrderIds.length,
        notTagged: result.notTaggedOrderIds.length,
        failed: 0,
        results: orderIds.map((orderId) => ({
          orderId,
          outcome: removed.has(orderId) ? 'removed' : 'not-tagged',
        })),
      };
    } catch (error) {
      if (error instanceof OrderTagNotFoundError) {
        throw this.mapNotFound(error, tagId);
      }
      const results = this.failAll(orderIds, 'bulk tag remove', error);
      return { tagId, removed: 0, notTagged: 0, failed: results.length, results };
    }
  }

  /** The write is one batched statement, so an unexpected error fails every row alike. */
  private failAll(orderIds: readonly string[], action: string, error: unknown): BulkOrderTagResultDto[] {
    const reason = unexpectedRowFailure(this.logger, action, orderIds.join(','), error);
    return orderIds.map((orderId) => ({ orderId, outcome: 'failed' as const, reason }));
  }

  private mapNotFound(error: unknown, id: string): Error {
    if (error instanceof OrderTagNotFoundError) {
      return new NotFoundException(`Order tag not found: ${id}`);
    }
    return error as Error;
  }

  private toDto(tag: OrderTagWithCount): OrderTagResponseDto {
    return {
      id: tag.id,
      name: tag.name,
      color: tag.color,
      orderCount: tag.orderCount,
      createdAt: tag.createdAt.toISOString(),
      updatedAt: tag.updatedAt.toISOString(),
    };
  }
}
