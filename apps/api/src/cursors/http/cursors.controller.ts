/**
 * Cursors Controller
 *
 * HTTP REST API endpoints for connection cursor read operations. Provides
 * endpoints for listing cursors with filters and retrieving individual cursors.
 * Cursors track incremental sync position per connection.
 *
 * @module apps/api/src/cursors/http
 */
import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  ConnectionCursorRepositoryPort,
  CONNECTION_CURSOR_REPOSITORY_TOKEN,
} from '@openlinker/core/sync';
import type { ConnectionCursor } from '@openlinker/core/sync';
import { ListCursorsQueryDto } from './dto/list-cursors-query.dto';
import { CursorResponseDto } from './dto/cursor-response.dto';
import { PaginatedCursorsResponseDto } from './dto/paginated-cursors-response.dto';

@ApiBearerAuth()
@ApiTags('cursors')
@Controller('cursors')
export class CursorsController {
  constructor(
    @Inject(CONNECTION_CURSOR_REPOSITORY_TOKEN)
    private readonly cursorRepository: ConnectionCursorRepositoryPort,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List connection cursors',
    description:
      'Returns a paginated list of connection cursors. Supports filtering by connectionId.',
  })
  @ApiResponse({ status: 200, description: 'Paginated cursor list', type: PaginatedCursorsResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async listCursors(@Query() query: ListCursorsQueryDto): Promise<PaginatedCursorsResponseDto> {
    const { connectionId, limit = 20, offset = 0 } = query;

    const { items, total } = await this.cursorRepository.findMany(
      { connectionId },
      { limit, offset },
    );

    return {
      items: items.map((cursor) => this.toDto(cursor)),
      total,
      limit,
      offset,
    };
  }

  @Get(':connectionId/:cursorKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single cursor by connection ID and cursor key' })
  @ApiResponse({ status: 200, description: 'Cursor detail', type: CursorResponseDto })
  @ApiResponse({ status: 404, description: 'Cursor not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getCursor(
    @Param('connectionId') connectionId: string,
    @Param('cursorKey') cursorKey: string,
  ): Promise<CursorResponseDto> {
    const cursor = await this.cursorRepository.findOne(connectionId, cursorKey);
    if (!cursor) {
      throw new NotFoundException(
        `Cursor not found: ${cursorKey} for connection ${connectionId}`,
      );
    }
    return this.toDto(cursor);
  }

  private toDto(cursor: ConnectionCursor): CursorResponseDto {
    return {
      connectionId: cursor.connectionId,
      cursorKey: cursor.cursorKey,
      value: cursor.value,
      createdAt: cursor.createdAt instanceof Date ? cursor.createdAt.toISOString() : cursor.createdAt,
      updatedAt: cursor.updatedAt instanceof Date ? cursor.updatedAt.toISOString() : cursor.updatedAt,
    };
  }
}
