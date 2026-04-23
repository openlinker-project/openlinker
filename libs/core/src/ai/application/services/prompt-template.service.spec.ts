/**
 * Prompt Template Service Unit Tests
 *
 * Covers every branch of the service: list / get / create / update / publish
 * / revert / render / delete. The repository is mocked as the port interface
 * so no real DB is needed.
 *
 * @module libs/core/src/ai/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PromptTemplate } from '../../domain/entities/prompt-template.entity';
import { PromptTemplateNotFoundException } from '../../domain/exceptions/prompt-template-not-found.exception';
import { PromptTemplateRenderException } from '../../domain/exceptions/prompt-template-render.exception';
import { PromptTemplateStateException } from '../../domain/exceptions/prompt-template-state.exception';
import type {
  PromptTemplateRepositoryPort,
  PromptTemplateSummary,
} from '../../domain/ports/prompt-template-repository.port';
import type { PromptTemplateVariable } from '../../domain/types/prompt-template.types';
import { PROMPT_TEMPLATE_REPOSITORY_TOKEN } from '../../ai.tokens';
import { PromptTemplateService } from './prompt-template.service';

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  const vars: readonly PromptTemplateVariable[] = [
    { name: 'product.name', type: 'string', required: true },
  ];
  return new PromptTemplate(
    overrides.id ?? 'tmpl-1',
    overrides.key ?? 'offer.description.suggest',
    overrides.channel !== undefined ? overrides.channel : 'allegro',
    overrides.version ?? 1,
    overrides.systemPrompt ?? 'System {{product.name}}',
    overrides.userPromptTemplate ?? 'User {{product.name}}',
    overrides.variables ?? vars,
    overrides.state ?? 'draft',
    overrides.publishedAt ?? null,
    overrides.createdBy ?? 'admin',
    overrides.createdAt ?? new Date('2026-04-22T10:00:00Z'),
    overrides.updatedAt ?? new Date('2026-04-22T10:00:00Z'),
  );
}

describe('PromptTemplateService', () => {
  let service: PromptTemplateService;
  let repository: jest.Mocked<PromptTemplateRepositoryPort>;

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      findByKeyChannelVersion: jest.fn(),
      findLatestPublished: jest.fn(),
      findVersions: jest.fn(),
      listLatestByKey: jest.fn(),
      insert: jest.fn(),
      updateContent: jest.fn(),
      publishTransition: jest.fn(),
      nextVersion: jest.fn(),
      deleteById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptTemplateService,
        { provide: PROMPT_TEMPLATE_REPOSITORY_TOKEN, useValue: repository },
      ],
    }).compile();

    service = module.get(PromptTemplateService);
  });

  describe('listLatestByKey', () => {
    it('should delegate to the repository with the provided filters', async () => {
      const summary: PromptTemplateSummary = {
        key: 'offer.description.suggest',
        channel: 'allegro',
        latestVersion: 2,
        latestId: 'tmpl-2',
        latestState: 'draft',
        publishedVersion: 1,
        publishedId: 'tmpl-1',
        hasDraft: true,
        updatedAt: new Date(),
      };
      repository.listLatestByKey.mockResolvedValue([summary]);

      const result = await service.listLatestByKey({ channel: 'allegro' });

      expect(repository.listLatestByKey).toHaveBeenCalledWith({ channel: 'allegro' });
      expect(result).toEqual([summary]);
    });
  });

  describe('getById', () => {
    it('should return the template when found', async () => {
      const template = makeTemplate();
      repository.findById.mockResolvedValue(template);
      await expect(service.getById('tmpl-1')).resolves.toBe(template);
    });

    it('should throw PromptTemplateNotFoundException when missing', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toBeInstanceOf(
        PromptTemplateNotFoundException,
      );
    });
  });

  describe('createDraft', () => {
    it('should assign version=1 for a brand-new (key, channel) pair', async () => {
      repository.nextVersion.mockResolvedValue(1);
      const inserted = makeTemplate({ version: 1, state: 'draft' });
      repository.insert.mockResolvedValue(inserted);

      await service.createDraft({
        key: 'offer.description.suggest',
        channel: 'allegro',
        systemPrompt: 'sys',
        userPromptTemplate: 'user',
        variables: [],
        createdBy: 'admin',
      });

      expect(repository.nextVersion).toHaveBeenCalledWith('offer.description.suggest', 'allegro');
      expect(repository.insert).toHaveBeenCalledWith(
        expect.objectContaining({ version: 1, state: 'draft', createdBy: 'admin' }),
      );
    });

    it('should assign next version when priors exist', async () => {
      repository.nextVersion.mockResolvedValue(5);
      repository.insert.mockResolvedValue(makeTemplate({ version: 5 }));

      await service.createDraft({
        key: 'offer.description.suggest',
        channel: null,
        systemPrompt: 'sys',
        userPromptTemplate: 'user',
        variables: [],
        createdBy: null,
      });

      expect(repository.insert).toHaveBeenCalledWith(
        expect.objectContaining({ version: 5, channel: null, createdBy: null }),
      );
    });
  });

  describe('updateDraft', () => {
    it('should update a draft row', async () => {
      const existing = makeTemplate({ state: 'draft' });
      const updated = makeTemplate({ systemPrompt: 'new-sys' });
      repository.findById.mockResolvedValue(existing);
      repository.updateContent.mockResolvedValue(updated);

      const result = await service.updateDraft('tmpl-1', { systemPrompt: 'new-sys' });

      expect(result).toBe(updated);
      expect(repository.updateContent).toHaveBeenCalledWith('tmpl-1', {
        systemPrompt: 'new-sys',
        userPromptTemplate: undefined,
        variables: undefined,
      });
    });

    it('should refuse when state is published', async () => {
      repository.findById.mockResolvedValue(makeTemplate({ state: 'published' }));
      await expect(
        service.updateDraft('tmpl-1', { systemPrompt: 'x' }),
      ).rejects.toBeInstanceOf(PromptTemplateStateException);
      expect(repository.updateContent).not.toHaveBeenCalled();
    });

    it('should refuse when state is archived', async () => {
      repository.findById.mockResolvedValue(makeTemplate({ state: 'archived' }));
      await expect(
        service.updateDraft('tmpl-1', { systemPrompt: 'x' }),
      ).rejects.toBeInstanceOf(PromptTemplateStateException);
    });

    it('should throw NotFound when template is missing', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(
        service.updateDraft('missing', { systemPrompt: 'x' }),
      ).rejects.toBeInstanceOf(PromptTemplateNotFoundException);
    });
  });

  describe('publish', () => {
    it('should delegate to publishTransition for a draft', async () => {
      const draft = makeTemplate({ state: 'draft' });
      const published = makeTemplate({ state: 'published', publishedAt: new Date() });
      repository.findById.mockResolvedValue(draft);
      repository.publishTransition.mockResolvedValue(published);

      const result = await service.publish('tmpl-1', 'admin');

      expect(repository.publishTransition).toHaveBeenCalledWith('tmpl-1');
      expect(result).toBe(published);
    });

    it('should refuse to publish a non-draft row', async () => {
      repository.findById.mockResolvedValue(makeTemplate({ state: 'published' }));
      await expect(service.publish('tmpl-1', null)).rejects.toBeInstanceOf(
        PromptTemplateStateException,
      );
      expect(repository.publishTransition).not.toHaveBeenCalled();
    });

    it('should throw NotFound when template is missing', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.publish('missing', null)).rejects.toBeInstanceOf(
        PromptTemplateNotFoundException,
      );
    });
  });

  describe('revertTo', () => {
    it('should clone a historical version into a new draft with the next version number', async () => {
      const source = makeTemplate({
        id: 'tmpl-3',
        version: 3,
        state: 'archived',
        systemPrompt: 'old-sys',
        userPromptTemplate: 'old-user',
      });
      repository.findByKeyChannelVersion.mockResolvedValue(source);
      repository.nextVersion.mockResolvedValue(7);
      const clone = makeTemplate({
        id: 'tmpl-7',
        version: 7,
        state: 'draft',
        systemPrompt: 'old-sys',
        userPromptTemplate: 'old-user',
      });
      repository.insert.mockResolvedValue(clone);

      const result = await service.revertTo({
        key: 'offer.description.suggest',
        channel: 'allegro',
        version: 3,
        createdBy: 'admin',
      });

      expect(result).toBe(clone);
      expect(repository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 7,
          state: 'draft',
          systemPrompt: 'old-sys',
          userPromptTemplate: 'old-user',
          createdBy: 'admin',
        }),
      );
    });

    it('should throw when the source version does not exist', async () => {
      repository.findByKeyChannelVersion.mockResolvedValue(null);
      await expect(
        service.revertTo({
          key: 'offer.description.suggest',
          channel: 'allegro',
          version: 99,
          createdBy: 'admin',
        }),
      ).rejects.toBeInstanceOf(PromptTemplateNotFoundException);
    });
  });

  describe('render', () => {
    it('should resolve the latest published template and substitute variables', async () => {
      const published = makeTemplate({
        state: 'published',
        systemPrompt: 'sys {{product.name}}',
        userPromptTemplate: 'user {{product.name}}',
      });
      repository.findLatestPublished.mockResolvedValue(published);

      const result = await service.render({
        key: 'offer.description.suggest',
        channel: 'allegro',
        values: { product: { name: 'Cap' } },
      });

      expect(result.systemPrompt).toBe('sys Cap');
      expect(result.userPrompt).toBe('user Cap');
      expect(result.templateId).toBe(published.id);
      expect(result.version).toBe(published.version);
    });

    it('should throw when no published row exists', async () => {
      repository.findLatestPublished.mockResolvedValue(null);
      await expect(
        service.render({
          key: 'offer.description.suggest',
          channel: 'allegro',
          values: { product: { name: 'Cap' } },
        }),
      ).rejects.toBeInstanceOf(PromptTemplateNotFoundException);
    });

    it('should surface PromptTemplateRenderException when required vars are missing', async () => {
      const published = makeTemplate({
        state: 'published',
        systemPrompt: 'sys {{product.name}}',
        userPromptTemplate: 'user',
      });
      repository.findLatestPublished.mockResolvedValue(published);

      await expect(
        service.render({
          key: 'offer.description.suggest',
          channel: 'allegro',
          values: {},
        }),
      ).rejects.toBeInstanceOf(PromptTemplateRenderException);
    });
  });

  describe('renderById', () => {
    it('should load by id and render', async () => {
      const template = makeTemplate({
        systemPrompt: 'sys {{product.name}}',
        userPromptTemplate: 'user',
      });
      repository.findById.mockResolvedValue(template);

      const result = await service.renderById('tmpl-1', { product: { name: 'Cap' } });

      expect(result.systemPrompt).toBe('sys Cap');
    });
  });

  describe('deleteDraft', () => {
    it('should delete a draft row', async () => {
      repository.findById.mockResolvedValue(makeTemplate({ state: 'draft' }));
      await service.deleteDraft('tmpl-1');
      expect(repository.deleteById).toHaveBeenCalledWith('tmpl-1');
    });

    it('should refuse to delete a published row', async () => {
      repository.findById.mockResolvedValue(makeTemplate({ state: 'published' }));
      await expect(service.deleteDraft('tmpl-1')).rejects.toBeInstanceOf(
        PromptTemplateStateException,
      );
      expect(repository.deleteById).not.toHaveBeenCalled();
    });
  });
});
