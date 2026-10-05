/**
 * Stream Dead Letters Controller
 *
 * HTTP REST endpoint for the durable poison-stream-entry terminal state
 * (#2301, D48): a read-only list + count of `stream_dead_letters` rows,
 * rendered on Diagnostics > Jobs & Logs.
 *
 * Read-only by design in this pass — no replay action. A dead-lettered
 * entry's raw fields are evidence for a human to read, not (yet) a request
 * this repository knows how to safely re-drive; see ADR-049's amendment
 * (#2301, D48) for the reasoning.
 *
 * Lives under `sync/` (rather than a bare top-level prefix) because it is
 * rendered alongside the existing sync-jobs diagnostics table and reached
 * from the same page — the `ConnectionSyncStatusController` precedent for
 * a nested, sync-adjacent read.
 *
 * @module apps/api/src/sync/http
 */
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { StreamDeadLetter } from '@openlinker/core/events';
import { STREAM_DEAD_LETTERS_SERVICE_TOKEN , IStreamDeadLettersService} from '@openlinker/core/events';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ListStreamDeadLettersQueryDto } from './dto/list-stream-dead-letters-query.dto';
import { PaginatedStreamDeadLettersResponseDto } from './dto/paginated-stream-dead-letters-response.dto';
import type { StreamDeadLetterResponseDto } from './dto/stream-dead-letter-response.dto';
import { StreamDeadLettersCountResponseDto } from './dto/stream-dead-letters-count-response.dto';

@ApiBearerAuth()
@ApiTags('sync')
@Controller('sync/stream-dead-letters')
export class StreamDeadLettersController {
  constructor(
    @Inject(STREAM_DEAD_LETTERS_SERVICE_TOKEN)
    private readonly streamDeadLetters: IStreamDeadLettersService
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'List poison Redis Stream entries that exhausted recovery',
    description:
      'Returns entries whose consumer failed to recover them MAX_RECOVERY_ATTEMPTS times and ' +
      'were durably dead-lettered rather than left retrying forever. Each row carries the raw ' +
      'stream fields exactly as read (no typed reconstruction), since a typed payload is ' +
      'precisely what could not be built from a raw pending entry. Read-only — there is no ' +
      'replay action in this pass.',
  })
  @ApiResponse({ status: 200, type: PaginatedStreamDeadLettersResponseDto })
  async list(
    @Query() query: ListStreamDeadLettersQueryDto
  ): Promise<PaginatedStreamDeadLettersResponseDto> {
    const { stream, limit = 20, offset = 0 } = query;
    const page = await this.streamDeadLetters.list({ stream }, { limit, offset });
    return {
      items: page.items.map((item) => this.toDto(item)),
      total: page.total,
      limit,
      offset,
    };
  }

  @Get('count')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary: 'Count poison Redis Stream entries that exhausted recovery',
    description:
      'Same filter as the list endpoint, count only — cheap to poll for a badge without ' +
      'paginating the full list.',
  })
  @ApiResponse({ status: 200, type: StreamDeadLettersCountResponseDto })
  async count(
    @Query('stream') stream?: string
  ): Promise<StreamDeadLettersCountResponseDto> {
    const count = await this.streamDeadLetters.count({ stream });
    return { count };
  }

  private toDto(entry: StreamDeadLetter): StreamDeadLetterResponseDto {
    return {
      id: entry.id,
      stream: entry.stream,
      consumerGroup: entry.consumerGroup,
      entryId: entry.entryId,
      rawFields: entry.rawFields,
      attempts: entry.attempts,
      lastError: entry.lastError,
      firstSeenAt: entry.firstSeenAt.toISOString(),
      lastSeenAt: entry.lastSeenAt.toISOString(),
    };
  }
}
