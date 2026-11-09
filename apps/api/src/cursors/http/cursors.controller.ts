/**
 * Cursors Controller
 *
 * HTTP REST API endpoints for connection cursor read operations. Provides
 * endpoints for listing cursors with filters and retrieving individual cursors.
 * Cursors track incremental sync position per connection.
 *
 * @module apps/api/src/cursors/http
 *
 * **`@Roles('admin', 'operator', 'viewer')`, not `@AnyRole()` (#2413).** A sync
 * cursor is connection diagnostics; the `packer` role has no business in one.
 * Behaviourally identical for every role that exists today.
 */
import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  Post,
  Body,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
  CURSOR_OVERVIEW_SERVICE_TOKEN,
  CursorRewindRefusedError,
  ICursorOverviewService,
} from '@openlinker/core/sync';
import type { ConnectionCursor, CursorOverview } from '@openlinker/core/sync';
import { CursorOverviewResponseDto } from './dto/cursor-overview-response.dto';
import { CursorOverviewQueryDto } from './dto/cursor-overview-query.dto';
import { RewindCursorDto, RewindCursorResponseDto } from './dto/rewind-cursor.dto';
import { ListCursorsQueryDto } from './dto/list-cursors-query.dto';
import { CursorResponseDto } from './dto/cursor-response.dto';
import { PaginatedCursorsResponseDto } from './dto/paginated-cursors-response.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { codedHttpError } from '../../common/errors/coded-http.exception';

@ApiBearerAuth()
@ApiTags('cursors')
@Controller('cursors')
export class CursorsController {
  constructor(
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort,
    @Inject(CURSOR_OVERVIEW_SERVICE_TOKEN)
    private readonly overviewService: ICursorOverviewService
  ) {}

  @Roles('admin', 'operator', 'viewer')
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cursor overview grouped by connection (#4023)',
    description:
      'Every cursor grouped by connection, each with the newest run of the job that advances it. Per-listing stock write marks are summarised as `writeMarks` instead of listed. At most 1,000 cursors are read; `truncated` says when more exist, and `connectionId` narrows the read to one connection.',
  })
  @ApiResponse({ status: 200, type: CursorOverviewResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getOverview(@Query() query: CursorOverviewQueryDto): Promise<CursorOverviewResponseDto> {
    return toOverviewDto(
      await this.overviewService.getOverview({ connectionId: query.connectionId })
    );
  }

  @Roles('admin')
  @Post(':connectionId/rewind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move a cursor back to a named target (#4023)',
    description:
      "Accepts only the target the cursor catalogue allows for the key. Order feeds cannot be moved back: their cursor is the platform adapter's own format.",
  })
  @ApiResponse({ status: 200, type: RewindCursorResponseDto })
  @ApiResponse({ status: 400, description: 'The key cannot be moved back, or not to this target' })
  @ApiResponse({ status: 404, description: 'Cursor not found' })
  @ApiResponse({ status: 409, description: 'The pass already finished, or a run is in progress' })
  async rewind(
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Body() dto: RewindCursorDto
  ): Promise<RewindCursorResponseDto> {
    try {
      return await this.overviewService.rewind({
        connectionId,
        cursorKey: dto.cursorKey,
        target: dto.target,
      });
    } catch (error) {
      if (error instanceof CursorRewindRefusedError) {
        const body = { message: error.message, reason: error.reason };
        if (error.reason === 'cursor-not-found') throw new NotFoundException(body);
        if (error.reason === 'pass-not-open' || error.reason === 'run-in-progress')
          throw new ConflictException(body);
        throw new BadRequestException(body);
      }
      throw error;
    }
  }

  @Roles('admin', 'operator', 'viewer')
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List connection cursors',
    description:
      'Returns a paginated list of connection cursors. Supports filtering by connectionId.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated cursor list',
    type: PaginatedCursorsResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listCursors(@Query() query: ListCursorsQueryDto): Promise<PaginatedCursorsResponseDto> {
    const { connectionId, keyPrefix, limit = 20, offset = 0 } = query;

    const { items, total } = await this.cursorRepository.findMany(
      { connectionId, keyPrefix },
      { limit, offset }
    );

    return {
      items: items.map((cursor) => this.toDto(cursor)),
      total,
      limit,
      offset,
    };
  }

  @Roles('admin', 'operator', 'viewer')
  @Get(':connectionId/:cursorKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single cursor by connection ID and cursor key' })
  @ApiResponse({ status: 200, description: 'Cursor detail', type: CursorResponseDto })
  @ApiResponse({ status: 404, description: 'Cursor not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getCursor(
    @Param('connectionId') connectionId: string,
    @Param('cursorKey') cursorKey: string
  ): Promise<CursorResponseDto> {
    const cursor = await this.cursorRepository.findOne(connectionId, cursorKey);
    if (!cursor) {
      throw codedHttpError(
        HttpStatus.NOT_FOUND,
        'CURSOR_NOT_FOUND',
        `Cursor not found: ${cursorKey} for connection ${connectionId}`,
        { cursorKey, connectionId },
      );
    }
    return this.toDto(cursor);
  }

  private toDto(cursor: ConnectionCursor): CursorResponseDto {
    return {
      connectionId: cursor.connectionId,
      cursorKey: cursor.cursorKey,
      value: cursor.value,
      createdAt:
        cursor.createdAt instanceof Date ? cursor.createdAt.toISOString() : cursor.createdAt,
      updatedAt:
        cursor.updatedAt instanceof Date ? cursor.updatedAt.toISOString() : cursor.updatedAt,
    };
  }
}

function toOverviewDto(overview: CursorOverview): CursorOverviewResponseDto {
  return {
    truncated: overview.truncated,
    connections: overview.connections.map((c) => ({
      connectionId: c.connectionId,
      cursors: c.cursors.map((item) => ({
        cursorKey: item.cursorKey,
        value: item.value,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        family: item.family,
        rewind: item.rewind,
        lastRun: item.lastRun
          ? {
              jobId: item.lastRun.jobId,
              jobType: item.lastRun.jobType,
              status: item.lastRun.status,
              outcome: item.lastRun.outcome,
              at: item.lastRun.at.toISOString(),
              lastError: item.lastRun.lastError,
            }
          : null,
      })),
      writeMarks: c.writeMarks
        ? {
            keyPrefix: c.writeMarks.keyPrefix,
            count: c.writeMarks.count,
            oldestValue: c.writeMarks.oldestValue,
            newestValue: c.writeMarks.newestValue,
            lastUpdatedAt: c.writeMarks.lastUpdatedAt.toISOString(),
          }
        : null,
    })),
  };
}
