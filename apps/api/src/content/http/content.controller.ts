/**
 * Content Controller
 *
 * Admin-only REST surface for the product-scoped content editor (#339) and
 * the AI description suggestion flow (#342). Delegates persistence and
 * publish to `IContentDraftService`, the read-side compose to
 * `IContentStateReaderService`, and AI completion to
 * `IContentSuggestionService`. The controller itself only maps transport
 * concerns + domain exceptions to HTTP.
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
  CONTENT_STATE_READER_SERVICE_TOKEN,
  CONTENT_SUGGESTION_SERVICE_TOKEN,
  ChannelAdapterLacksFieldUpdaterException,
  ContentConflictException,
  ContentFieldNotFoundException,
  NoLinkedOffersException,
  type ContentChannelState,
  type ContentMasterState,
  type IContentDraftService,
  type IContentStateReaderService,
  type IContentSuggestionService,
} from '@openlinker/core/content';
import {
  PromptTemplateNotFoundException,
  PromptTemplateRenderException,
  PromptTemplateStateException,
} from '@openlinker/core/ai';
import { AllegroApiException } from '@openlinker/integrations-allegro';
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

@ApiBearerAuth()
@ApiTags('content')
@Controller('products/:productId/content')
export class ContentController {
  constructor(
    @Inject(CONTENT_DRAFT_SERVICE_TOKEN)
    private readonly drafts: IContentDraftService,
    @Inject(CONTENT_STATE_READER_SERVICE_TOKEN)
    private readonly stateReader: IContentStateReaderService,
    @Inject(CONTENT_SUGGESTION_SERVICE_TOKEN)
    private readonly suggestions: IContentSuggestionService,
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({ summary: 'Fetch master + channel content state for a product' })
  @ApiResponse({ status: 200, type: ContentStateResponseDto })
  async getState(
    @Param('productId') productId: string,
  ): Promise<ContentStateResponseDto> {
    return this.mapExceptions(async () => {
      const state = await this.stateReader.readState(productId);
      const response = new ContentStateResponseDto();
      response.productId = state.productId;
      response.master = toMasterStateDto(state.master);
      response.channels = state.channels.map(toChannelStateDto);
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
      // #486: surface Allegro 4xx with structured `errors[]` as an
      // operator-actionable 422 body. Single-platform scope today (Allegro is
      // the only channel publisher); when a second platform-specific
      // exception emerges, hoist this into a neutral
      // `ChannelPublishRejectedException` in core/content.
      if (error instanceof AllegroApiException) {
        if (error.statusCode === 422 && error.allegroErrors && error.allegroErrors.length > 0) {
          throw new UnprocessableEntityException({
            message: 'Channel publish rejected by Allegro',
            code: 'CHANNEL_PUBLISH_FAILED',
            errors: error.allegroErrors.map((e) => ({
              field: e.path && e.path !== 'null' ? e.path : undefined,
              code: e.code,
              // Polish `userMessage` first — operators are PL-first per the
              // issue. FE translator (`translateAllegroError`) replaces this
              // with operator-actionable English when the code is in the
              // allowlist; otherwise it renders verbatim.
              message: e.userMessage ?? e.message,
            })),
          });
        }
        // Non-422 (5xx, auth-shaped 4xx, ...) or 422 with no parseable body:
        // not the operator's problem to fix. Surface as bad-gateway so the
        // FE doesn't render an empty error list under a 422 header.
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }
}

function toMasterStateDto(state: ContentMasterState): ContentMasterStateDto {
  const dto = new ContentMasterStateDto();
  dto.baseValue = state.baseValue;
  dto.draftValue = state.draftValue;
  dto.hasConflict = state.hasConflict;
  dto.updatedAt = state.updatedAt;
  dto.updatedBy = state.updatedBy;
  return dto;
}

function toChannelStateDto(state: ContentChannelState): ContentChannelStateDto {
  const dto = new ContentChannelStateDto();
  dto.connectionId = state.connectionId;
  dto.connectionName = state.connectionName;
  dto.platformType = state.platformType;
  dto.connectionStatus = state.connectionStatus;
  dto.baseValue = state.baseValue;
  dto.draftValue = state.draftValue;
  dto.hasConflict = state.hasConflict;
  dto.updatedAt = state.updatedAt;
  dto.updatedBy = state.updatedBy;
  dto.linkedOfferCount = state.linkedOfferCount;
  return dto;
}
