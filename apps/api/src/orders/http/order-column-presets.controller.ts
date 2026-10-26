/**
 * Order Column Presets Controller (#3530)
 *
 * HTTP CRUD for `/orders`-list column presets, shared with the export UI
 * (#3534/#3535). Personal: a caller reads and writes only their own presets
 * (`GET /orders/column-presets` lists ONLY the caller's own — never another
 * user's, and never the workspace default mixed into that array). The
 * workspace default (D32) is a SEPARATE resource with its own admin-only
 * write, resolved by `GET /orders/column-presets/workspace-default`.
 *
 * Guards are GLOBAL (`auth.module` `APP_GUARD` = `JwtAuthGuard` then
 * `RolesGuard`) — no redundant `@UseGuards`. `@Roles('admin', 'operator')`
 * throughout: a viewer has no reason to save a personal column arrangement
 * they cannot act on, mirroring the write-gated posture of other
 * operator-facing preference surfaces in this app.
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
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  ORDER_COLUMN_PRESET_SERVICE_TOKEN,
  OrderColumnPresetNotFoundError,
  type IOrderColumnPresetService,
  type OrderColumnPreset,
} from '@openlinker/core/orders';
import { CreateOrderColumnPresetDto } from './dto/create-order-column-preset.dto';
import { UpdateOrderColumnPresetDto } from './dto/update-order-column-preset.dto';
import { SetWorkspaceDefaultColumnsDto } from './dto/set-workspace-default-columns.dto';
import { OrderColumnPresetResponseDto } from './dto/order-column-preset-response.dto';

@ApiBearerAuth()
@ApiTags('orders')
@Controller('orders/column-presets')
export class OrderColumnPresetsController {
  constructor(
    @Inject(ORDER_COLUMN_PRESET_SERVICE_TOKEN)
    private readonly service: IOrderColumnPresetService
  ) {}

  @Roles('admin', 'operator')
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "The caller's own saved column presets." })
  @ApiResponse({ status: 200, type: [OrderColumnPresetResponseDto] })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<OrderColumnPresetResponseDto[]> {
    const presets = await this.service.listForUser(user.id);
    return presets.map((preset) => this.toDto(preset));
  }

  @Roles('admin', 'operator')
  @Get('workspace-default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'The admin-set workspace default (D32) a user with no saved preset starts from, or null.',
  })
  @ApiResponse({ status: 200, type: OrderColumnPresetResponseDto })
  async getWorkspaceDefault(): Promise<OrderColumnPresetResponseDto | null> {
    const preset = await this.service.getWorkspaceDefault();
    return preset ? this.toDto(preset) : null;
  }

  @Roles('admin')
  @Put('workspace-default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sets the workspace-default column set (D32, admin only). Replaces the whole set; never ' +
      'touches any user\'s already-saved personal preset.',
  })
  @ApiResponse({ status: 200, type: OrderColumnPresetResponseDto })
  async setWorkspaceDefault(
    @Body() dto: SetWorkspaceDefaultColumnsDto
  ): Promise<OrderColumnPresetResponseDto> {
    const preset = await this.service.setWorkspaceDefault(dto.columns);
    return this.toDto(preset);
  }

  @Roles('admin', 'operator')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save a new personal column preset.' })
  @ApiResponse({ status: 201, type: OrderColumnPresetResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderColumnPresetDto
  ): Promise<OrderColumnPresetResponseDto> {
    const preset = await this.service.create(user.id, dto.name, dto.columns);
    return this.toDto(preset);
  }

  @Roles('admin', 'operator')
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Rename or replace the column set of one of the caller's own presets.",
  })
  @ApiResponse({ status: 200, type: OrderColumnPresetResponseDto })
  @ApiResponse({ status: 404, description: 'Not found, or not owned by the caller.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderColumnPresetDto
  ): Promise<OrderColumnPresetResponseDto> {
    try {
      const preset = await this.service.update(user.id, id, dto);
      return this.toDto(preset);
    } catch (error) {
      if (error instanceof OrderColumnPresetNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Roles('admin', 'operator')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete one of the caller's own presets." })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiResponse({ status: 404, description: 'Not found, or not owned by the caller.' })
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    try {
      await this.service.delete(user.id, id);
    } catch (error) {
      if (error instanceof OrderColumnPresetNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  private toDto(preset: OrderColumnPreset): OrderColumnPresetResponseDto {
    return {
      id: preset.id,
      userId: preset.userId,
      name: preset.name,
      columns: preset.columns,
      createdAt: preset.createdAt.toISOString(),
      updatedAt: preset.updatedAt.toISOString(),
    };
  }
}
