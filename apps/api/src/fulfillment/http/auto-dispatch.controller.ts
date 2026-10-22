/**
 * Auto-Dispatch Controller (#2729)
 *
 * `GET  connections/:connectionId/auto-dispatch/refusals` - recent refusals,
 *       split into "needs your input" and "retrying automatically".
 * `POST connections/:connectionId/auto-dispatch/preview`  - what a DRAFT
 *       configuration would do to the connection's recent orders.
 *
 * Both are reads. The preview is a POST only because the draft settings travel
 * in a body that is not yet saved anywhere; it buys no label and writes no row.
 *
 * `:connectionId` is the connection that HOLDS the work (`assignedConnectionId`),
 * not necessarily a carrier connection, and every response says so.
 *
 * Admin and operator only: the preview names orders and the refusal read names
 * work, and neither is for a `viewer` or a `packer`.
 *
 * @module apps/api/src/fulfillment/http
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../auth/decorators/roles.decorator';
import {
  AUTO_DISPATCH_READ_SERVICE_TOKEN,
  type IAutoDispatchReadService,
} from '../application/interfaces/auto-dispatch-read.service.interface';
import {
  AUTO_DISPATCH_READ_DEFAULT_LIMIT,
  AutoDispatchPreviewRequestDto,
  AutoDispatchPreviewResponseDto,
  AutoDispatchRefusalsQueryDto,
  AutoDispatchRefusalsResponseDto,
} from './dto/auto-dispatch.dto';

const PREVIEW_DEFAULT_LIMIT = 10;

@ApiBearerAuth()
@ApiTags('fulfillment')
@Controller('connections/:connectionId/auto-dispatch')
export class AutoDispatchController {
  constructor(
    @Inject(AUTO_DISPATCH_READ_SERVICE_TOKEN) private readonly reads: IAutoDispatchReadService
  ) {}

  @Get('refusals')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Recent automatic-label refusals for a connection',
    description:
      'Jobs of `fulfillment.work.autoDispatch` on the connection that holds the work, split into ' +
      '`needsInput` (nothing changes until someone acts) and `retrying` (still on the retry ' +
      'ladder). Only codes, ids and counts are returned. `already-has-label` is a success and ' +
      'never appears.',
  })
  @ApiResponse({ status: 200, type: AutoDispatchRefusalsResponseDto })
  @ApiResponse({ status: 404, description: 'Unknown connection' })
  async listRefusals(
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Query() query: AutoDispatchRefusalsQueryDto
  ): Promise<AutoDispatchRefusalsResponseDto> {
    return await this.reads.listRefusals(connectionId, query.limit ?? AUTO_DISPATCH_READ_DEFAULT_LIMIT);
  }

  @Post('preview')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @ApiOperation({
    summary: 'Preview automatic labels against a draft configuration',
    description:
      'Resolves the weight, template and box for the connection’s most recent orders with the ' +
      'DRAFT settings in the body, and says which orders would be refused and why. Reads only: no ' +
      'label is bought and nothing is written. The draft is coerced exactly as a saved ' +
      'configuration is, so it cannot show a parcel the worker would not build.',
  })
  @ApiResponse({ status: 200, type: AutoDispatchPreviewResponseDto })
  @ApiResponse({ status: 404, description: 'Unknown connection' })
  async preview(
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Body() body: AutoDispatchPreviewRequestDto
  ): Promise<AutoDispatchPreviewResponseDto> {
    const { limit, ...draft } = body;
    return await this.reads.preview(connectionId, draft, limit ?? PREVIEW_DEFAULT_LIMIT);
  }
}
