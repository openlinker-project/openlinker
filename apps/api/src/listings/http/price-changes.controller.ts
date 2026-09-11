/**
 * Price Changes Controller (#3145, ADR-072)
 *
 * Thin HTTP orchestration over `IPriceChangesService`. Guarded per
 * `docs/architecture-overview.md § Capability Assignment` /
 * `engineering-standards.md § Route authorization` — reads are
 * `admin`/`operator`/`viewer` (matching every other Listings read), writes
 * are `admin`/`operator` (ADR-072 decision 6: reuses the `connections:write`-
 * shaped gating already used for day-to-day listings operator actions, never
 * the `admin`-only gate `ConnectionController`'s own config writes use).
 *
 * @module apps/api/src/listings/http
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Query, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  PRICE_CHANGES_SERVICE_TOKEN,
  PriceChangeEpisodeAlreadyResolvedException,
  PriceChangeEpisodeBlockedException,
  PriceChangeEpisodeNotFoundException,
  PriceChangeEpisodeStaleException,
  type IPriceChangesService,
} from '@openlinker/core/listings';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import { ListPriceChangesQueryDto } from './dto/list-price-changes-query.dto';
import { AcceptPriceChangeDto } from './dto/accept-price-change.dto';
import { EditPriceChangeDto } from './dto/edit-price-change.dto';
import { BulkAcceptPriceChangesDto } from './dto/bulk-accept-price-changes.dto';
import { PriceChangeListResponseDto } from './dto/price-change-list-response.dto';
import { BulkAcceptPriceChangesResponseDto } from './dto/bulk-accept-price-changes-response.dto';
import { PriceChangeAutoAppliedItemResponseDto } from './dto/price-change-auto-applied-response.dto';

const DEFAULT_AUTO_APPLIED_LIMIT = 20;

@ApiTags('listings')
@ApiBearerAuth()
@Controller('listings/price-changes')
export class PriceChangesController {
  constructor(
    @Inject(PRICE_CHANGES_SERVICE_TOKEN)
    private readonly priceChanges: IPriceChangesService
  ) {}

  @Get()
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({ summary: 'List open price-change episodes (the review queue).' })
  @ApiResponse({ status: 200, type: PriceChangeListResponseDto })
  async list(@Query() query: ListPriceChangesQueryDto): Promise<PriceChangeListResponseDto> {
    const page = await this.priceChanges.listOpen({
      destinationConnectionId: query.connectionId,
      direction: query.direction,
      magnitudeLargeOnly: query.magnitudeLarge,
    });
    return PriceChangeListResponseDto.fromDomain(page);
  }

  @Get('auto-applied')
  @Roles('admin', 'operator', 'viewer')
  @ApiOperation({
    summary:
      'Recently-applied-automatically log (ADR-072 decision 3) — deliberately not paginated/filterable.',
  })
  @ApiResponse({ status: 200, type: [PriceChangeAutoAppliedItemResponseDto] })
  async autoApplied(): Promise<PriceChangeAutoAppliedItemResponseDto[]> {
    const entries = await this.priceChanges.listAutoApplied(DEFAULT_AUTO_APPLIED_LIMIT);
    return entries.map((entry) => PriceChangeAutoAppliedItemResponseDto.fromDomain(entry));
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'Accept the rule-computed price and publish it.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Episode not found' })
  @ApiResponse({ status: 409, description: 'Already resolved, blocked, or stale (re-detected since last read)' })
  async accept(
    @Param('id') id: string,
    @Body() dto: AcceptPriceChangeDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    await this.wrapDomainErrors(() =>
      this.priceChanges.accept(id, {
        optInAutomatic: dto.optInAutomatic,
        expectedVersion: dto.expectedVersion,
        resolvedByUserId: user.id,
      })
    );
  }

  @Post(':id/ignore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'Keep the old (live) price — marks the episode ignored.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Episode not found' })
  @ApiResponse({ status: 409, description: 'Already resolved' })
  async ignore(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.wrapDomainErrors(() => this.priceChanges.ignore(id, user.id));
  }

  @Post(':id/unresolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin', 'operator')
  @ApiOperation({ summary: "Undo a previous 'Keep price' decision, re-opening the episode." })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Episode not found' })
  @ApiResponse({ status: 409, description: 'Not currently ignored (e.g. already accepted)' })
  async unresolve(@Param('id') id: string): Promise<void> {
    await this.wrapDomainErrors(() => this.priceChanges.unresolve(id));
  }

  @Post(':id/edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'Publish an operator-pinned price instead of the rule-computed one.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Episode not found' })
  @ApiResponse({ status: 409, description: 'Already resolved, blocked, or stale' })
  async edit(
    @Param('id') id: string,
    @Body() dto: EditPriceChangeDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    await this.wrapDomainErrors(() =>
      this.priceChanges.edit(id, {
        manualPriceOverride: dto.manualPriceOverride,
        optInAutomatic: dto.optInAutomatic,
        expectedVersion: dto.expectedVersion,
        resolvedByUserId: user.id,
      })
    );
  }

  @Post('bulk')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary:
      'Accept N episodes together. Returns a batch id pollable via the existing bulk-batch-progress mechanism.',
  })
  @ApiResponse({ status: 200, type: BulkAcceptPriceChangesResponseDto })
  async bulkAccept(
    @Body() dto: BulkAcceptPriceChangesDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BulkAcceptPriceChangesResponseDto> {
    const result = await this.wrapDomainErrors(() =>
      this.priceChanges.bulkAccept(dto.items, user.id)
    );
    return BulkAcceptPriceChangesResponseDto.fromDomain(result);
  }

  private async wrapDomainErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof PriceChangeEpisodeNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof PriceChangeEpisodeAlreadyResolvedException ||
        error instanceof PriceChangeEpisodeStaleException
      ) {
        throw new ConflictException(error.message);
      }
      if (error instanceof PriceChangeEpisodeBlockedException) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }
}
