/**
 * Content Controller
 *
 * Admin-only REST surface for the product-scoped content editor (#339) and
 * the AI description suggestion flow (#342). Delegates persistence and
 * publish to `IContentDraftService`, suggestion to `IContentSuggestionService`.
 * Reads compose `ContentDraftService` row state + active OfferFieldUpdater
 * connections + linked-offer counts.
 *
 * @module apps/api/src/content/http
 */
import {
  BadRequestException,
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AiCompletionError } from '@openlinker/core/ai';
import {
  CONTENT_DRAFT_SERVICE_TOKEN,
  CONTENT_SUGGESTION_SERVICE_TOKEN,
  PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
  ChannelAdapterLacksFieldUpdaterException,
  ContentConflictException,
  ContentFieldNotFoundException,
  NoLinkedOffersException,
  type IContentDraftService,
  type IContentSuggestionService,
  type ProductContentField,
  type ProductContentFieldRepositoryPort,
} from '@openlinker/core/content';
import {
  PromptTemplateNotFoundException,
  PromptTemplateRenderException,
  PromptTemplateStateException,
} from '@openlinker/core/ai';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import type { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import {
  isOfferFieldUpdater,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  type OfferManagerPort,
  type OfferMappingRepositoryPort,
} from '@openlinker/core/listings';
import type { ProductMasterPort } from '@openlinker/core/products/domain/ports/product-master.port';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  ContentChannelStateDto,
  ContentMasterStateDto,
  ContentStateResponseDto,
} from './dto/content-state-response.dto';
import { ContentFieldResponseDto } from './dto/content-field-response.dto';
import { DiscardContentDraftDto } from './dto/discard-content-draft.dto';
import { PublishContentDto } from './dto/publish-content.dto';
import { SaveContentDraftDto } from './dto/save-content-draft.dto';
import { SuggestContentDto } from './dto/suggest-content.dto';
import { SuggestionResponseDto } from './dto/suggestion-response.dto';

const DESCRIPTION_KEY = 'description';

@ApiBearerAuth()
@ApiTags('content')
@Controller('products/:productId/content')
export class ContentController {
  constructor(
    @Inject(CONTENT_DRAFT_SERVICE_TOKEN)
    private readonly drafts: IContentDraftService,
    @Inject(CONTENT_SUGGESTION_SERVICE_TOKEN)
    private readonly suggestions: IContentSuggestionService,
    @Inject(PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN)
    private readonly repository: ProductContentFieldRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappings: OfferMappingRepositoryPort,
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({ summary: 'Fetch master + channel content state for a product' })
  @ApiResponse({ status: 200, type: ContentStateResponseDto })
  async getState(
    @Param('productId') productId: string,
  ): Promise<ContentStateResponseDto> {
    return this.mapExceptions(async () => {
      // 1. All rows for the product on the single field key.
      const rows = await this.repository.findByProduct(productId, DESCRIPTION_KEY);
      const master = rows.find((row) => row.connectionId === null) ?? null;
      const channelRowsById = new Map<string, ProductContentField>();
      for (const row of rows) {
        if (row.connectionId !== null) channelRowsById.set(row.connectionId, row);
      }

      // 2. Discover content-capable connections.
      const offerManagers = await this.integrations.listCapabilityAdapters<OfferManagerPort>({
        capability: 'OfferManager',
      });

      const masters = await this.integrations.listCapabilityAdapters<ProductMasterPort>({
        capability: 'ProductMaster',
      });
      const productMaster = masters[0]?.adapter ?? null;
      const variants = productMaster
        ? await productMaster.getProductVariants(productId).catch(() => [])
        : [];

      const channels: ContentChannelStateDto[] = [];
      for (const entry of offerManagers) {
        if (entry.connection.status !== 'active') continue;
        if (!isOfferFieldUpdater(entry.adapter)) continue;

        let linkedOfferCount = 0;
        for (const variant of variants) {
          const page = await this.offerMappings.findMany(
            { connectionId: entry.connectionId, internalId: variant.id },
            { limit: 100, offset: 0 },
          );
          linkedOfferCount += page.items.length;
        }
        if (linkedOfferCount === 0) continue;

        const row = channelRowsById.get(entry.connectionId);
        channels.push(this.buildChannelStateDto(entry.connectionId, entry.connection, row, linkedOfferCount));
      }

      channels.sort(
        (a, b) =>
          a.connectionName.localeCompare(b.connectionName) ||
          a.connectionId.localeCompare(b.connectionId),
      );

      const response = new ContentStateResponseDto();
      response.productId = productId;
      response.master = this.buildMasterStateDto(master);
      response.channels = channels;
      return response;
    });
  }

  @Roles('admin')
  @Post('draft')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a draft value on the master or a channel override' })
  @ApiResponse({ status: 200, type: ContentFieldResponseDto })
  async saveDraft(
    @Param('productId') productId: string,
    @Body() dto: SaveContentDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ContentFieldResponseDto> {
    return this.mapExceptions(async () => {
      const row = await this.drafts.saveDraft({
        productId,
        connectionId: dto.connectionId ?? null,
        fieldKey: dto.fieldKey,
        value: dto.value,
        userId: user.username,
      });
      return ContentFieldResponseDto.fromDomain(row);
    });
  }

  @Roles('admin')
  @Post('discard')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard a pending draft on the master or a channel override' })
  @ApiResponse({ status: 204 })
  async discardDraft(
    @Param('productId') productId: string,
    @Body() dto: DiscardContentDraftDto,
  ): Promise<void> {
    await this.mapExceptions(async () => {
      await this.drafts.discardDraft({
        productId,
        connectionId: dto.connectionId ?? null,
        fieldKey: dto.fieldKey,
      });
    });
  }

  @Roles('admin')
  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish the pending draft to the target platform' })
  @ApiResponse({ status: 200, type: ContentFieldResponseDto })
  async publish(
    @Param('productId') productId: string,
    @Body() dto: PublishContentDto,
  ): Promise<ContentFieldResponseDto> {
    return this.mapExceptions(async () => {
      const row = await this.drafts.publishDraft({
        productId,
        connectionId: dto.connectionId ?? null,
        fieldKey: dto.fieldKey,
      });
      return ContentFieldResponseDto.fromDomain(row);
    });
  }

  @Roles('admin')
  @Post('suggest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate an AI description suggestion without persisting it',
    description:
      'Runs synchronously inside the HTTP handler. The returned suggestion must be explicitly accepted via POST /draft; the AI never writes to the platform directly.',
  })
  @ApiResponse({ status: 200, type: SuggestionResponseDto })
  async suggest(
    @Param('productId') productId: string,
    @Body() dto: SuggestContentDto,
  ): Promise<SuggestionResponseDto> {
    return this.mapExceptions(async () => {
      const result = await this.suggestions.suggestDescription({
        productId,
        channel: dto.channel ?? null,
        tone: dto.tone,
        extraInstructions: dto.extraInstructions,
      });
      return SuggestionResponseDto.fromDomain(result);
    });
  }

  private buildMasterStateDto(row: ProductContentField | null): ContentMasterStateDto {
    const dto = new ContentMasterStateDto();
    dto.baseValue = row?.baseValue ?? null;
    dto.draftValue = row?.draftValue ?? null;
    dto.hasConflict = row?.hasConflict ?? false;
    dto.updatedAt = row?.updatedAt.toISOString() ?? null;
    dto.updatedBy = row?.updatedBy ?? null;
    return dto;
  }

  private buildChannelStateDto(
    connectionId: string,
    connection: { name: string; platformType: string; status: string },
    row: ProductContentField | undefined,
    linkedOfferCount: number,
  ): ContentChannelStateDto {
    const dto = new ContentChannelStateDto();
    dto.connectionId = connectionId;
    dto.connectionName = connection.name;
    dto.platformType = connection.platformType;
    dto.connectionStatus = connection.status;
    dto.baseValue = row?.baseValue ?? null;
    dto.draftValue = row?.draftValue ?? null;
    dto.hasConflict = row?.hasConflict ?? false;
    dto.updatedAt = row?.updatedAt.toISOString() ?? null;
    dto.updatedBy = row?.updatedBy ?? null;
    dto.linkedOfferCount = linkedOfferCount;
    return dto;
  }

  private async mapExceptions<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ContentConflictException) {
        throw new ConflictException(error.message);
      }
      if (error instanceof ContentFieldNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof ChannelAdapterLacksFieldUpdaterException) {
        throw new UnprocessableEntityException(error.message);
      }
      if (error instanceof NoLinkedOffersException) {
        throw new UnprocessableEntityException(error.message);
      }
      if (error instanceof PromptTemplateNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof PromptTemplateRenderException) {
        throw new UnprocessableEntityException(error.message);
      }
      if (error instanceof PromptTemplateStateException) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof AiCompletionError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }
}
