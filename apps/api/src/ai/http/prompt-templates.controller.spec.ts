/**
 * Prompt Templates Controller — Unit Tests
 *
 * Focused on the domain-exception → HTTP-status mapping that
 * `withDomainExceptionMapping` performs for the archive endpoint
 * (#489). The service is mocked at the port boundary; tests verify
 * the controller translates each domain exception to the right HTTP
 * shape (404 / 409 / 400) and returns the response DTO on the happy
 * path.
 *
 * @module apps/api/src/ai/http
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { IPromptTemplateService } from '@openlinker/core/ai';
import {
  CannotArchivePublishedTemplateException,
  PROMPT_TEMPLATE_SERVICE_TOKEN,
  PromptTemplate,
  PromptTemplateNotFoundException,
  PromptTemplateStateException,
} from '@openlinker/core/ai';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { PromptTemplatesController } from './prompt-templates.controller';

const adminUser: AuthenticatedUser = {
  id: 'u1',
  username: 'admin',
  role: 'admin',
};

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return new PromptTemplate(
    overrides.id ?? 'tmpl-1',
    overrides.key ?? 'offer.description.suggest',
    overrides.channel !== undefined ? overrides.channel : 'allegro',
    overrides.version ?? 1,
    overrides.systemPrompt ?? 'sys',
    overrides.userPromptTemplate ?? 'user',
    overrides.variables ?? [],
    overrides.state ?? 'archived',
    overrides.publishedAt ?? null,
    overrides.createdBy ?? 'admin',
    overrides.createdAt ?? new Date('2026-04-22T10:00:00Z'),
    overrides.updatedAt ?? new Date('2026-04-22T10:00:00Z')
  );
}

describe('PromptTemplatesController', () => {
  let controller: PromptTemplatesController;
  let service: jest.Mocked<IPromptTemplateService>;

  beforeEach(async () => {
    service = {
      listLatestByKey: jest.fn(),
      getById: jest.fn(),
      getVersions: jest.fn(),
      getLatestPublished: jest.fn(),
      createDraft: jest.fn(),
      updateDraft: jest.fn(),
      publish: jest.fn(),
      revertTo: jest.fn(),
      render: jest.fn(),
      renderById: jest.fn(),
      deleteDraft: jest.fn(),
      archive: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PromptTemplatesController],
      providers: [{ provide: PROMPT_TEMPLATE_SERVICE_TOKEN, useValue: service }],
    }).compile();

    controller = module.get(PromptTemplatesController);
  });

  describe('archive (#489)', () => {
    it('should return the archived template DTO on the happy path', async () => {
      const archived = makeTemplate({ state: 'archived', version: 3 });
      service.archive.mockResolvedValue(archived);

      const result = await controller.archive('tmpl-1', { force: false }, adminUser);

      expect(service.archive).toHaveBeenCalledWith('tmpl-1', {
        force: false,
        actor: 'admin',
      });
      expect(result.id).toBe('tmpl-1');
      expect(result.state).toBe('archived');
      expect(result.version).toBe(3);
    });

    it('should pass force=true through to the service when the body sets it', async () => {
      service.archive.mockResolvedValue(makeTemplate({ state: 'archived' }));

      await controller.archive('tmpl-1', { force: true }, adminUser);

      expect(service.archive).toHaveBeenCalledWith('tmpl-1', {
        force: true,
        actor: 'admin',
      });
    });

    it('should map CannotArchivePublishedTemplateException to ConflictException (409)', async () => {
      service.archive.mockRejectedValue(
        new CannotArchivePublishedTemplateException({
          templateId: 'tmpl-1',
          key: 'offer.description.suggest',
          channel: 'allegro',
        })
      );

      await expect(controller.archive('tmpl-1', {}, adminUser)).rejects.toBeInstanceOf(
        ConflictException
      );
    });

    it('should map PromptTemplateNotFoundException to NotFoundException (404)', async () => {
      service.archive.mockRejectedValue(
        new PromptTemplateNotFoundException({ templateId: 'tmpl-1' })
      );

      await expect(controller.archive('tmpl-1', {}, adminUser)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('should map PromptTemplateStateException to BadRequestException (400) for concurrent-modification', async () => {
      service.archive.mockRejectedValue(
        new PromptTemplateStateException({
          templateId: 'tmpl-1',
          actualState: 'published',
          requiredState: 'draft',
          operation: 'be archived (concurrent modification — refresh and retry)',
        })
      );

      await expect(controller.archive('tmpl-1', {}, adminUser)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });
  });

  describe('open-world channel (#580)', () => {
    it('should forward an unknown channel string to the service on list()', async () => {
      service.listLatestByKey.mockResolvedValue([]);

      await controller.list(undefined, 'shopify');

      // The channel is open-world (#580): a non-empty string the controller
      // doesn't recognise still reaches the service verbatim, with no closed-
      // set rejection. The service falls back to the master template if no
      // 'shopify' row is published.
      expect(service.listLatestByKey).toHaveBeenCalledWith({
        key: undefined,
        channel: 'shopify',
      });
    });

    it('should map the `master` sentinel to a null channel filter', async () => {
      service.listLatestByKey.mockResolvedValue([]);

      await controller.list(undefined, 'master');

      expect(service.listLatestByKey).toHaveBeenCalledWith({
        key: undefined,
        channel: null,
      });
    });

    it('should drop an empty channel query into "no filter"', async () => {
      service.listLatestByKey.mockResolvedValue([]);

      await controller.list(undefined, '');

      expect(service.listLatestByKey).toHaveBeenCalledWith({
        key: undefined,
        channel: undefined,
      });
    });
  });
});
