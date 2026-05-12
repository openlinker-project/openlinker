/**
 * Prompt Templates Controller
 *
 * Admin-only REST surface for the editable prompt-template storage
 * (#341). Delegates to `IPromptTemplateService`; translates domain
 * exceptions to HTTP responses (NotFound / BadRequest / UnprocessableEntity).
 *
 * Every handler carries `@Roles('admin')` — non-admin callers receive 403
 * via the existing `RolesGuard`.
 *
 * @module apps/api/src/ai/http
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CannotArchivePublishedTemplateException,
  IPromptTemplateService,
  PROMPT_TEMPLATE_SERVICE_TOKEN,
  PromptTemplate,
  PromptTemplateChannel,
  PromptTemplateNotFoundException,
  PromptTemplateRenderException,
  PromptTemplateStateException,
} from '@openlinker/core/ai';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ArchivePromptTemplateDto } from './dto/archive-prompt-template.dto';
import { CreatePromptTemplateDto } from './dto/create-prompt-template.dto';
import { PromptTemplateResponseDto } from './dto/prompt-template-response.dto';
import { PromptTemplateSummaryResponseDto } from './dto/prompt-template-summary-response.dto';
import { RenderPromptTemplateDto } from './dto/render-prompt-template.dto';
import { RenderedPromptResponseDto } from './dto/rendered-prompt-response.dto';
import { RevertPromptTemplateDto } from './dto/revert-prompt-template.dto';
import { UpdatePromptTemplateDto } from './dto/update-prompt-template.dto';

@ApiBearerAuth()
@ApiTags('prompt-templates')
@Controller('prompt-templates')
export class PromptTemplatesController {
  constructor(
    @Inject(PROMPT_TEMPLATE_SERVICE_TOKEN)
    private readonly service: IPromptTemplateService,
  ) {}

  @Roles('admin')
  @Get()
  @ApiOperation({ summary: 'List latest prompt template per (key, channel) pair' })
  @ApiResponse({ status: 200, type: [PromptTemplateSummaryResponseDto] })
  async list(
    @Query('key') key?: string,
    @Query('channel') channel?: string,
  ): Promise<PromptTemplateSummaryResponseDto[]> {
    const summaries = await this.service.listLatestByKey({
      key: key ?? undefined,
      channel: this.parseChannelFilter(channel),
    });
    return summaries.map((summary) => PromptTemplateSummaryResponseDto.fromDomain(summary));
  }

  @Roles('admin')
  @Get('latest')
  @ApiOperation({ summary: 'Get the latest published template for a (key, channel) pair' })
  @ApiResponse({ status: 200, type: PromptTemplateResponseDto })
  async getLatestPublished(
    @Query('key') key: string,
    @Query('channel') channel?: string,
  ): Promise<PromptTemplateResponseDto> {
    if (!key || key.trim() === '') {
      throw new BadRequestException('`key` query parameter is required');
    }
    // Does not use `withDomainExceptionMapping` because the service returns
    // `null` (legitimate "no published version yet" state) rather than
    // throwing. Translating null → 404 happens inline on this single endpoint.
    const template = await this.service.getLatestPublished(
      key,
      this.parseChannelStrict(channel),
    );
    if (template === null) {
      throw new NotFoundException(`No published template for key=${key}, channel=${channel ?? 'master'}`);
    }
    return PromptTemplateResponseDto.fromDomain(template);
  }

  @Roles('admin')
  @Get('versions')
  @ApiOperation({ summary: 'Get version history for a (key, channel) pair' })
  @ApiResponse({ status: 200, type: [PromptTemplateResponseDto] })
  async getVersions(
    @Query('key') key: string,
    @Query('channel') channel?: string,
  ): Promise<PromptTemplateResponseDto[]> {
    if (!key || key.trim() === '') {
      throw new BadRequestException('`key` query parameter is required');
    }
    const versions = await this.service.getVersions(key, this.parseChannelStrict(channel));
    return versions.map((template) => PromptTemplateResponseDto.fromDomain(template));
  }

  @Roles('admin')
  @Get(':id')
  @ApiOperation({ summary: 'Get a prompt template by id' })
  @ApiResponse({ status: 200, type: PromptTemplateResponseDto })
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PromptTemplateResponseDto> {
    return this.withDomainExceptionMapping(async () => {
      const template = await this.service.getById(id);
      return PromptTemplateResponseDto.fromDomain(template);
    });
  }

  @Roles('admin')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new draft prompt template' })
  @ApiResponse({ status: 201, type: PromptTemplateResponseDto })
  async create(
    @Body() dto: CreatePromptTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    const created = await this.service.createDraft({
      key: dto.key,
      channel: dto.channel ?? null,
      systemPrompt: dto.systemPrompt,
      userPromptTemplate: dto.userPromptTemplate,
      variables: dto.variables,
      createdBy: user.username,
    });
    return PromptTemplateResponseDto.fromDomain(created);
  }

  @Roles('admin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft prompt template' })
  @ApiResponse({ status: 200, type: PromptTemplateResponseDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePromptTemplateDto,
  ): Promise<PromptTemplateResponseDto> {
    return this.withDomainExceptionMapping(async () => {
      const updated = await this.service.updateDraft(id, {
        systemPrompt: dto.systemPrompt,
        userPromptTemplate: dto.userPromptTemplate,
        variables: dto.variables,
      });
      return PromptTemplateResponseDto.fromDomain(updated);
    });
  }

  @Roles('admin')
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a draft prompt template' })
  @ApiResponse({ status: 200, type: PromptTemplateResponseDto })
  async publish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    return this.withDomainExceptionMapping(async () => {
      const published = await this.service.publish(id, user.username);
      return PromptTemplateResponseDto.fromDomain(published);
    });
  }

  @Roles('admin')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a draft or published prompt template (#489)',
    description:
      'Soft-archive a prompt template row. Idempotent for already-archived rows. ' +
      'Refuses to archive a published row without `{ "force": true }` because the ' +
      'partial unique index makes it the only published version for its (key, channel).',
  })
  @ApiResponse({ status: 200, type: PromptTemplateResponseDto })
  @ApiResponse({ status: 404, description: 'Template not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot archive the only published row for the (key, channel) pair without force',
  })
  async archive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ArchivePromptTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    return this.withDomainExceptionMapping(async () => {
      const archived = await this.service.archive(id, {
        force: dto.force,
        actor: user.username,
      });
      return PromptTemplateResponseDto.fromDomain(archived);
    });
  }

  @Roles('admin')
  @Post('revert')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Clone a historical version into a new draft' })
  @ApiResponse({ status: 201, type: PromptTemplateResponseDto })
  async revert(
    @Body() dto: RevertPromptTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PromptTemplateResponseDto> {
    return this.withDomainExceptionMapping(async () => {
      const draft = await this.service.revertTo({
        key: dto.key,
        channel: dto.channel ?? null,
        version: dto.version,
        createdBy: user.username,
      });
      return PromptTemplateResponseDto.fromDomain(draft);
    });
  }

  @Roles('admin')
  @Post(':id/render')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Render a prompt template by id (preview)' })
  @ApiResponse({ status: 200, type: RenderedPromptResponseDto })
  async render(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenderPromptTemplateDto,
  ): Promise<RenderedPromptResponseDto> {
    return this.withDomainExceptionMapping(async () => {
      const rendered = await this.service.renderById(id, dto.values);
      return RenderedPromptResponseDto.fromDomain(rendered);
    });
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft prompt template' })
  @ApiResponse({ status: 204 })
  async deleteDraft(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.withDomainExceptionMapping<PromptTemplate | void>(async () => {
      await this.service.deleteDraft(id);
    });
  }

  /**
   * Query parameter for `channel` accepts:
   *   - omitted          → no filter (returns master + channel rows)
   *   - `master`         → channel IS NULL
   *   - any non-empty string → exact channel match
   *
   * Channel is open-world per #580 — values match `connection.platformType`
   * (e.g. `'allegro'`, `'shopify'`). The controller no longer cross-checks
   * against a closed enum; format-validation (non-empty) is sufficient.
   */
  private parseChannelFilter(value: string | undefined): PromptTemplateChannel | null | undefined {
    if (value === undefined || value === '') return undefined;
    if (value === 'master') return null;
    return value;
  }

  /**
   * Strict parser used on endpoints where `channel` is required semantically
   * (fetch-latest, fetch-versions). `undefined` / empty / `'master'` → NULL channel.
   */
  private parseChannelStrict(value: string | undefined): PromptTemplateChannel | null {
    if (value === undefined || value === '' || value === 'master') return null;
    return value;
  }

  private async withDomainExceptionMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof PromptTemplateNotFoundException) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof CannotArchivePublishedTemplateException) {
        throw new ConflictException(error.message);
      }
      if (error instanceof PromptTemplateStateException) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof PromptTemplateRenderException) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }
}
