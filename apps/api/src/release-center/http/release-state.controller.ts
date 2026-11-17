/**
 * Release State Controller
 *
 * Per-user release cursor and item state, plus installation-wide step state
 * (ADR-085). Every route names its roles: reads and user-scope writes are open
 * to admin/operator/viewer, installation steps are admin only, and `packer`
 * (the bench's temporary role) reaches none of it. The user id comes from the
 * token only.
 *
 * @module apps/api/src/release-center/http
 */
import { Body, Controller, Get, Inject, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import type { ReleaseItemStateChange } from '@openlinker/core/release-center';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  RELEASE_STATE_VIEW_SERVICE_TOKEN,
  type IReleaseStateViewService,
} from '../release-state-view.service.interface';
import {
  ReleaseCursorResponseDto,
  ReleaseItemStateResponseDto,
  ReleaseItemStatesResponseDto,
  ReleaseStateResponseDto,
  UpdateInstallationReleaseStepsDto,
  UpdateReleaseCursorDto,
  UpdateReleaseCursorResponseDto,
  UpdateUserReleaseItemsDto,
} from './dto/release-state.dto';

@ApiBearerAuth()
@ApiTags('release-state')
@Controller('release-state')
export class ReleaseStateController {
  constructor(
    @Inject(RELEASE_STATE_VIEW_SERVICE_TOKEN)
    private readonly view: IReleaseStateViewService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @ApiOperation({ summary: 'Read the caller release cursor, item states and the enabled flag' })
  @ApiResponse({ status: 200, type: ReleaseStateResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ): Promise<ReleaseStateResponseDto> {
    res.setHeader('Cache-Control', 'no-store');
    const state = await this.view.getView(user.id);
    const actor = user.role === 'admin';
    return {
      enabled: state.enabled,
      cursor: ReleaseCursorResponseDto.from(state.cursor),
      user: state.user.map((s) => ReleaseItemStateResponseDto.from(s, actor)),
      installation: state.installation.map((s) => ReleaseItemStateResponseDto.from(s, actor)),
    };
  }

  @Roles('admin', 'operator', 'viewer')
  @Put('cursor')
  @ApiOperation({ summary: 'Advance the caller release cursor and/or set skipDialog' })
  @ApiResponse({ status: 200, type: UpdateReleaseCursorResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid version' })
  async putCursor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateReleaseCursorDto
  ): Promise<UpdateReleaseCursorResponseDto> {
    const result = await this.view.advanceCursor(user.id, {
      version: dto.version,
      skipDialog: dto.skipDialog,
    });
    return { applied: result.applied, cursor: ReleaseCursorResponseDto.from(result.cursor) };
  }

  @Roles('admin', 'operator', 'viewer')
  @Put('items')
  @ApiOperation({
    summary: 'Set the caller item states in a batch (also serves "mark all")',
  })
  @ApiResponse({ status: 200, type: ReleaseItemStatesResponseDto })
  @ApiResponse({ status: 422, description: 'Per-user limit reached' })
  async putItems(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserReleaseItemsDto
  ): Promise<ReleaseItemStatesResponseDto> {
    const changes: ReleaseItemStateChange[] = dto.changes.map((c) => ({
      itemKey: c.itemKey,
      status: c.status,
      doneVia: c.doneVia,
      snoozedUntil: c.snoozedUntil ? new Date(c.snoozedUntil) : null,
    }));
    const rows = await this.view.applyUserStates(user.id, changes);
    const actor = user.role === 'admin';
    return { items: rows.map((r) => ReleaseItemStateResponseDto.from(r, actor)) };
  }

  @Roles('admin')
  @Put('steps')
  @ApiOperation({ summary: 'Set installation-wide setup step states in a batch (admin only)' })
  @ApiResponse({ status: 200, type: ReleaseItemStatesResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 422, description: 'Installation limit reached or unknown connection' })
  async putSteps(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateInstallationReleaseStepsDto
  ): Promise<ReleaseItemStatesResponseDto> {
    const changes: ReleaseItemStateChange[] = dto.changes.map((c) => ({
      itemKey: c.itemKey,
      status: c.status,
      doneVia: c.doneVia,
    }));
    const rows = await this.view.applyInstallationStates(user.id, changes);
    return { items: rows.map((r) => ReleaseItemStateResponseDto.from(r, true)) };
  }
}
