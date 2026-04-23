/**
 * Prompt Template Service
 *
 * Implements the full editable-prompt-template lifecycle: CRUD, publish
 * with archive-previous semantics, revert (clone a historical version into
 * a new draft), and render (resolve latest published and substitute
 * variables via the pure helper).
 *
 * @module libs/core/src/ai/application/services
 * @implements {IPromptTemplateService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { PromptTemplateNotFoundException } from '../../domain/exceptions/prompt-template-not-found.exception';
import { PromptTemplateStateException } from '../../domain/exceptions/prompt-template-state.exception';
import type { PromptTemplate } from '../../domain/entities/prompt-template.entity';
import type {
  PromptTemplateListFilters,
  PromptTemplateRepositoryPort,
  PromptTemplateSummary,
} from '../../domain/ports/prompt-template-repository.port';
import type { PromptTemplateChannel } from '../../domain/types/prompt-template.types';
import { PROMPT_TEMPLATE_REPOSITORY_TOKEN } from '../../ai.tokens';
import { renderTemplate } from '../internal/render-template';
import type {
  CreateDraftCommand,
  RenderCommand,
  RenderedPrompt,
  RevertToCommand,
  UpdateDraftCommand,
} from '../types/prompt-template-commands.types';
import type { IPromptTemplateService } from './prompt-template.service.interface';

@Injectable()
export class PromptTemplateService implements IPromptTemplateService {
  private readonly logger = new Logger(PromptTemplateService.name);

  constructor(
    @Inject(PROMPT_TEMPLATE_REPOSITORY_TOKEN)
    private readonly repository: PromptTemplateRepositoryPort,
  ) {}

  listLatestByKey(filters?: PromptTemplateListFilters): Promise<PromptTemplateSummary[]> {
    return this.repository.listLatestByKey(filters);
  }

  async getById(id: string): Promise<PromptTemplate> {
    const template = await this.repository.findById(id);
    if (template === null) {
      throw new PromptTemplateNotFoundException({ templateId: id });
    }
    return template;
  }

  getVersions(key: string, channel: PromptTemplateChannel | null): Promise<PromptTemplate[]> {
    return this.repository.findVersions(key, channel);
  }

  getLatestPublished(
    key: string,
    channel: PromptTemplateChannel | null,
  ): Promise<PromptTemplate | null> {
    return this.repository.findLatestPublished(key, channel);
  }

  async createDraft(cmd: CreateDraftCommand): Promise<PromptTemplate> {
    const version = await this.repository.nextVersion(cmd.key, cmd.channel);
    return this.repository.insert({
      key: cmd.key,
      channel: cmd.channel,
      version,
      systemPrompt: cmd.systemPrompt,
      userPromptTemplate: cmd.userPromptTemplate,
      variables: cmd.variables,
      state: 'draft',
      publishedAt: null,
      createdBy: cmd.createdBy,
    });
  }

  async updateDraft(id: string, cmd: UpdateDraftCommand): Promise<PromptTemplate> {
    const existing = await this.repository.findById(id);
    if (existing === null) {
      throw new PromptTemplateNotFoundException({ templateId: id });
    }
    if (existing.state !== 'draft') {
      throw new PromptTemplateStateException({
        templateId: id,
        actualState: existing.state,
        requiredState: 'draft',
        operation: 'be edited',
      });
    }
    return this.repository.updateContent(id, {
      systemPrompt: cmd.systemPrompt,
      userPromptTemplate: cmd.userPromptTemplate,
      variables: cmd.variables,
    });
  }

  async publish(id: string, actor: string | null): Promise<PromptTemplate> {
    const existing = await this.repository.findById(id);
    if (existing === null) {
      throw new PromptTemplateNotFoundException({ templateId: id });
    }
    if (existing.state !== 'draft') {
      throw new PromptTemplateStateException({
        templateId: id,
        actualState: existing.state,
        requiredState: 'draft',
        operation: 'be published',
      });
    }

    const published = await this.repository.publishTransition(id);
    this.logger.log(
      `[prompt-template] published templateId=${published.id} key=${published.key} channel=${
        published.channel ?? 'master'
      } version=${published.version} actor=${actor ?? 'system'}`,
    );
    return published;
  }

  async revertTo(cmd: RevertToCommand): Promise<PromptTemplate> {
    const source = await this.repository.findByKeyChannelVersion(
      cmd.key,
      cmd.channel,
      cmd.version,
    );
    if (source === null) {
      throw new PromptTemplateNotFoundException({
        key: cmd.key,
        channel: cmd.channel,
        version: cmd.version,
      });
    }

    const nextVersion = await this.repository.nextVersion(cmd.key, cmd.channel);
    const clone = await this.repository.insert({
      key: source.key,
      channel: source.channel,
      version: nextVersion,
      systemPrompt: source.systemPrompt,
      userPromptTemplate: source.userPromptTemplate,
      variables: source.variables,
      state: 'draft',
      publishedAt: null,
      createdBy: cmd.createdBy,
    });
    this.logger.log(
      `[prompt-template] reverted source=v${source.version} into draft=v${clone.version} key=${clone.key} channel=${
        clone.channel ?? 'master'
      } templateId=${clone.id} actor=${cmd.createdBy ?? 'system'}`,
    );
    return clone;
  }

  async render(cmd: RenderCommand): Promise<RenderedPrompt> {
    const template = await this.repository.findLatestPublished(cmd.key, cmd.channel);
    if (template === null) {
      throw new PromptTemplateNotFoundException({
        key: cmd.key,
        channel: cmd.channel,
      });
    }
    return this.renderFromEntity(template, cmd.values);
  }

  async renderById(id: string, values: Record<string, unknown>): Promise<RenderedPrompt> {
    const template = await this.getById(id);
    return this.renderFromEntity(template, values);
  }

  async deleteDraft(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (existing === null) {
      throw new PromptTemplateNotFoundException({ templateId: id });
    }
    if (existing.state !== 'draft') {
      throw new PromptTemplateStateException({
        templateId: id,
        actualState: existing.state,
        requiredState: 'draft',
        operation: 'be deleted',
      });
    }
    await this.repository.deleteById(id);
  }

  private renderFromEntity(
    template: PromptTemplate,
    values: Record<string, unknown>,
  ): RenderedPrompt {
    return {
      templateId: template.id,
      version: template.version,
      systemPrompt: renderTemplate({
        template: template.systemPrompt,
        declared: template.variables,
        values,
      }),
      userPrompt: renderTemplate({
        template: template.userPromptTemplate,
        declared: template.variables,
        values,
      }),
    };
  }
}
