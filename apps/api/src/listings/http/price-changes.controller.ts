/**
 * Price Changes Controller (#3145, ADR-072)
 *
 * Thin HTTP orchestration over `IPriceChangesService`. Guarded per
 * `docs/architecture-overview.md § Capability Assignment` /
 * `engineering-standards.md § Route authorization` — reads are
 * `admin`/`operator`/`viewer` (matching every other Listings read), writes
 * are `admin`/`operator` (day-to-day listings operator actions).
 *
 * **The `automatic` opt-in is `admin`-only** (#3162 review — an earlier
 * revision's header claimed this reused "the `connections:write` gating",
 * which `role.types.spec.ts` directly contradicts: `ROLE_PERMISSIONS`
 * asserts `operator` does NOT carry `connections:write`, and that map is
 * informational only — `@Roles` is the actual authorization mechanism, per
 * that same spec's own comment). Setting `optInAutomatic` mutates
 * `Connection.config.priceSyncMode`, a connection-wide setting; the
 * sibling connection Pricing & sync settings surface (#3163) gates the
 * equivalent write at `admin`. Rather than widen that surface's gate to
 * `operator` — the connection-config surface an operator's own Undo
 * affordance could not reach — this endpoint refuses the opt-in for a
 * non-admin caller (`ForbiddenException`) instead of silently applying it:
 * an operator can still accept/edit/bulk-accept the price itself, they
 * simply cannot ALSO flip the connection into automatic mode. This keeps
 * both surfaces answering to the same gate; if #3163 ships with a
 * different rule, this refusal is the one to revisit to match it.
 *
 * @module apps/api/src/listings/http
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  PRICE_CHANGES_SERVICE_TOKEN,
  PriceChangeEpisodeAlreadyResolvedException,
  PriceChangeEpisodeBlockedException,
  PriceChangeEpisodeNotFoundException,
  PriceChangeEpisodeStaleException,
  PriceChangeEpisodeSupersededError,
  type IPriceChangesService,
  type PriceChangeResolutionResult,
} from '@openlinker/core/listings';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/auth.types';
import {
  PRICE_SYNC_MODE_OVERRIDE_SERVICE_TOKEN,
  type IPriceSyncModeOverrideService,
} from '../application/services/price-sync-mode-override.service';
import { ListPriceChangesQueryDto } from './dto/list-price-changes-query.dto';
import { AcceptPriceChangeDto } from './dto/accept-price-change.dto';
import { EditPriceChangeDto } from './dto/edit-price-change.dto';
import { BulkAcceptPriceChangesDto } from './dto/bulk-accept-price-changes.dto';
import { PriceChangeListResponseDto } from './dto/price-change-list-response.dto';
import { PriceChangeItemResponseDto } from './dto/price-change-item-response.dto';
import { BulkAcceptPriceChangesResponseDto } from './dto/bulk-accept-price-changes-response.dto';
import { PriceChangeAutoAppliedItemResponseDto } from './dto/price-change-auto-applied-response.dto';

const DEFAULT_AUTO_APPLIED_LIMIT = 20;

@ApiTags('listings')
@ApiBearerAuth()
@Controller('listings/price-changes')
export class PriceChangesController {
  constructor(
    @Inject(PRICE_CHANGES_SERVICE_TOKEN)
    private readonly priceChanges: IPriceChangesService,
    @Inject(PRICE_SYNC_MODE_OVERRIDE_SERVICE_TOKEN)
    private readonly priceSyncModeOverride: IPriceSyncModeOverrideService
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
      limit: query.limit,
      offset: query.offset,
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
    return entries.map((entry) => PriceChangeAutoAppliedItemResponseDto.fromView(entry));
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'Accept the rule-computed price and publish it.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Episode not found' })
  @ApiResponse({ status: 409, description: 'Already resolved, blocked, or stale (re-detected since last read)' })
  @ApiResponse({ status: 403, description: 'optInAutomatic requires the admin role' })
  async accept(
    @Param('id') id: string,
    @Body() dto: AcceptPriceChangeDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    this.assertOptInAllowed(dto.optInAutomatic, user);
    const result = await this.wrapDomainErrors(() =>
      this.priceChanges.accept(id, {
        optInAutomatic: dto.optInAutomatic,
        expectedVersion: dto.expectedVersion,
        resolvedByUserId: user.id,
      })
    );
    await this.applyOptIn(result);
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
  @ApiResponse({
    status: 409,
    description:
      'Not currently ignored (e.g. already accepted), or superseded by a fresh episode opened for the same key since this one was ignored',
  })
  async unresolve(@Param('id') id: string): Promise<void> {
    await this.wrapDomainErrors(() => this.priceChanges.unresolve(id));
  }

  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'operator')
  @ApiOperation({
    summary:
      "Acknowledge a re-detection — clears the row's 'this changed again' marker and returns it as it now stands.",
  })
  @ApiResponse({ status: 200, type: PriceChangeItemResponseDto })
  @ApiResponse({ status: 404, description: 'Episode not found' })
  @ApiResponse({ status: 409, description: 'Already resolved' })
  async refresh(@Param('id') id: string): Promise<PriceChangeItemResponseDto> {
    const item = await this.wrapDomainErrors(() => this.priceChanges.refresh(id));
    return PriceChangeItemResponseDto.fromDomain(item);
  }

  @Post(':id/edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin', 'operator')
  @ApiOperation({ summary: 'Publish an operator-pinned price instead of the rule-computed one.' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: 'Episode not found' })
  @ApiResponse({ status: 409, description: 'Already resolved, blocked, or stale' })
  @ApiResponse({ status: 403, description: 'optInAutomatic requires the admin role' })
  async edit(
    @Param('id') id: string,
    @Body() dto: EditPriceChangeDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<void> {
    this.assertOptInAllowed(dto.optInAutomatic, user);
    const result = await this.wrapDomainErrors(() =>
      this.priceChanges.edit(id, {
        manualPriceOverride: dto.manualPriceOverride,
        optInAutomatic: dto.optInAutomatic,
        expectedVersion: dto.expectedVersion,
        resolvedByUserId: user.id,
      })
    );
    await this.applyOptIn(result);
  }

  @Post('bulk')
  @Roles('admin', 'operator')
  @ApiOperation({
    summary:
      'Accept N episodes together. Returns a batch id pollable via the existing bulk-batch-progress mechanism.',
  })
  @ApiResponse({ status: 200, type: BulkAcceptPriceChangesResponseDto })
  @ApiResponse({ status: 403, description: 'optInAutomatic requires the admin role' })
  async bulkAccept(
    @Body() dto: BulkAcceptPriceChangesDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<BulkAcceptPriceChangesResponseDto> {
    if (dto.items.some((item) => item.optInAutomatic)) {
      this.assertOptInAllowed(true, user);
    }
    const result = await this.wrapDomainErrors(() =>
      this.priceChanges.bulkAccept(dto.items, user.id)
    );
    await this.priceSyncModeOverride.setSourceOverridesAutomatic(result.optInPairs);
    return BulkAcceptPriceChangesResponseDto.fromDomain(result);
  }

  /** Reject `optInAutomatic` from a non-admin caller rather than silently applying it (see class docblock). */
  private assertOptInAllowed(optInAutomatic: boolean | undefined, user: AuthenticatedUser): void {
    if (optInAutomatic && user.role !== 'admin') {
      throw new ForbiddenException(
        'Setting a source to automatic sync mode requires the admin role.'
      );
    }
  }

  private async applyOptIn(result: PriceChangeResolutionResult): Promise<void> {
    if (!result.optInPair) return;
    await this.priceSyncModeOverride.setSourceOverrideAutomatic(result.optInPair);
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
        error instanceof PriceChangeEpisodeStaleException ||
        error instanceof PriceChangeEpisodeSupersededError
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
