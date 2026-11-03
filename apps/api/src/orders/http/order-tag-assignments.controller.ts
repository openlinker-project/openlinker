/**
 * Order Tag Assignments Controller (#3532, D34)
 *
 * Which tags one order carries. Assignment writes are `admin`/`operator`,
 * mirroring every other `/orders` write; the read is open to the whole
 * order-register (tags carry no PII).
 *
 * @module apps/api/src/orders/http
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  ORDER_TAG_SERVICE_TOKEN,
  OrderTagNotFoundError,
  type IOrderTagService,
} from '@openlinker/core/orders';
import { AssignOrderTagDto } from './dto/assign-order-tag.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders/:internalOrderId/tags')
export class OrderTagAssignmentsController {
  constructor(
    @Inject(ORDER_TAG_SERVICE_TOKEN)
    private readonly service: IOrderTagService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tag ids assigned to this order.' })
  @ApiResponse({ status: 200, type: [String] })
  async list(@Param('internalOrderId') internalOrderId: string): Promise<string[]> {
    return this.service.listForOrder(internalOrderId);
  }

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Assign a tag. Idempotent — assigning twice is a no-op.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'No such tag.' })
  async assign(
    @Param('internalOrderId') internalOrderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssignOrderTagDto
  ): Promise<void> {
    try {
      await this.service.assign(dto.tagId, internalOrderId, user.id);
    } catch (error) {
      if (error instanceof OrderTagNotFoundError) {
        throw new NotFoundException(`Order tag not found: ${dto.tagId}`);
      }
      throw error;
    }
  }

  @Roles('admin', 'operator')
  @Delete(':tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unassign a tag.' })
  @ApiResponse({ status: 204 })
  async unassign(
    @Param('internalOrderId') internalOrderId: string,
    @Param('tagId') tagId: string
  ): Promise<void> {
    await this.service.unassign(tagId, internalOrderId);
  }
}
