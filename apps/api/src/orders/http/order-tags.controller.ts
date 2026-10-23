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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  ORDER_TAG_SERVICE_TOKEN,
  OrderTagLimitReachedError,
  OrderTagNotFoundError,
  type IOrderTagService,
  type OrderTagWithCount,
} from '@openlinker/core/orders';
import {
  CreateOrderTagDto,
  UpdateOrderTagDto,
  BulkAssignOrderTagDto,
} from './dto/create-order-tag.dto';
import { OrderTagResponseDto, BulkAssignOrderTagResponseDto } from './dto/order-tag-response.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('order-tags')
export class OrderTagsController {
  constructor(
    @Inject(ORDER_TAG_SERVICE_TOKEN)
    private readonly service: IOrderTagService
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
  @ApiResponse({ status: 404, description: 'No such tag.' })
  async bulkAssign(
    @Param('tagId') tagId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkAssignOrderTagDto
  ): Promise<BulkAssignOrderTagResponseDto> {
    try {
      return await this.service.bulkAssign(tagId, dto.orderIds, user.id);
    } catch (error) {
      throw this.mapNotFound(error, tagId);
    }
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
