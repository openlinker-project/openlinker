/**
 * Saved Views Service
 *
 * Enforces the rules the HTTP layer must not be the only guard for: who may
 * see and change which view, the size limits, and optimistic concurrency.
 *
 * - A personal view belongs to its owner. Everyone else gets NOT FOUND, never
 *   FORBIDDEN, so a guessed id discloses nothing.
 * - A shared view is readable (and cloneable, by creating a personal one) by
 *   every caller and writable only by an admin - checked here, not only by a
 *   route decorator.
 * - The default a caller lands on is resolved by one chain: their own explicit
 *   default, then the workspace default, then nothing (the system "All" view,
 *   which lives in frontend code). It never errors: a default that points at a
 *   deleted view silently falls through.
 *
 * @module libs/core/src/saved-views/application/services
 * @implements {ISavedViewsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { SavedView } from '../../domain/entities/saved-view.entity';
import {
  InvalidSavedViewError,
  SavedViewForbiddenError,
  SavedViewNotFoundError,
  SavedViewRevisionConflictError,
} from '../../domain/exceptions/saved-view.exceptions';
import {
  SavedViewRepositoryPort} from '../../domain/ports/saved-view-repository.port';
import type {
  SavedViewPatch
} from '../../domain/ports/saved-view-repository.port';
import {
  SAVED_VIEW_LIMITS,
  checkSavedViewDefinition,
  normaliseSavedViewName,
  readSavedViewDefinition,
} from '../../domain/types/saved-view.types';
import type {
  CreateSavedViewInput,
  SavedViewActor,
  SavedViewDefinition,
  SavedViewReadModel,
  UpdateSavedViewInput,
} from '../../domain/types/saved-view.types';
import { SavedViewDefinitionPolicyPort } from '../../domain/ports/saved-view-definition-policy.port';
import {
  SAVED_VIEW_DEFINITION_POLICY_TOKEN,
  SAVED_VIEW_REPOSITORY_TOKEN,
} from '../../saved-views.tokens';
import type { ISavedViewsService } from './saved-views.service.interface';

@Injectable()
export class SavedViewsService implements ISavedViewsService {
  private readonly logger = new Logger(SavedViewsService.name);

  constructor(
    @Inject(SAVED_VIEW_REPOSITORY_TOKEN)
    private readonly repository: SavedViewRepositoryPort,
    @Inject(SAVED_VIEW_DEFINITION_POLICY_TOKEN)
    private readonly definitionPolicy: SavedViewDefinitionPolicyPort
  ) {}

  async list(actor: SavedViewActor, pageKey: string): Promise<SavedViewReadModel[]> {
    const [views, explicit] = await Promise.all([
      this.repository.listVisible(actor.userId, pageKey),
      this.repository.findDefault(actor.userId, pageKey),
    ]);
    const defaultId = this.resolveDefaultId(views, explicit?.savedViewId, explicit !== null);
    return views.map((view) => this.toReadModel(view, actor, defaultId));
  }

  async create(actor: SavedViewActor, input: CreateSavedViewInput): Promise<SavedViewReadModel> {
    const name = this.requireName(input.name);
    const definition = await this.requireDefinition(input.pageKey, input.definition);

    if (input.scope === 'shared') {
      this.requireAdmin(actor);
    } else {
      if (input.workspaceDefault) {
        throw new InvalidSavedViewError(
          'workspaceDefault',
          'Only a shared view can be the workspace default',
          'malformed'
        );
      }
      // The cap is checked OUTSIDE the insert transaction, so two concurrent
      // creates by one user can overshoot by one. Accepted: the writer is a
      // single person clicking Save, the harm is one extra personal row, and a
      // serialising lock would cost every create to prevent that.
      const count = await this.repository.countPersonal(actor.userId, input.pageKey);
      if (count >= SAVED_VIEW_LIMITS.personalViewsPerUserAndPage) {
        throw new InvalidSavedViewError(
          'pageKey',
          `At most ${SAVED_VIEW_LIMITS.personalViewsPerUserAndPage} personal views per page`,
          'too-many-views',
          SAVED_VIEW_LIMITS.personalViewsPerUserAndPage
        );
      }
    }

    const created = await this.repository.insert({
      scope: input.scope,
      // A shared view is installation-owned: it must outlive its author, so it
      // carries no owner (the cascade follows `ownerUserId`) and records the
      // author separately.
      ownerUserId: input.scope === 'personal' ? actor.userId : null,
      createdByUserId: actor.userId,
      pageKey: input.pageKey,
      name,
      definition,
      isWorkspaceDefault: input.workspaceDefault === true,
    });
    if (created.scope === 'shared') this.audit('created', actor, created);
    const explicit = await this.repository.findDefault(actor.userId, input.pageKey);
    const views = await this.repository.listVisible(actor.userId, input.pageKey);
    const defaultId = this.resolveDefaultId(views, explicit?.savedViewId, explicit !== null);
    return this.toReadModel(created, actor, defaultId);
  }

  async update(
    actor: SavedViewActor,
    id: string,
    input: UpdateSavedViewInput
  ): Promise<SavedViewReadModel> {
    const view = await this.requireWritable(actor, id);

    const patch: SavedViewPatch = {};
    if (input.name !== undefined) patch.name = this.requireName(input.name);
    if (input.definition !== undefined) {
      patch.definition = await this.requireDefinition(view.pageKey, input.definition);
    }
    if (input.workspaceDefault !== undefined) {
      if (view.scope !== 'shared') {
        throw new InvalidSavedViewError(
          'workspaceDefault',
          'Only a shared view can be the workspace default',
          'malformed'
        );
      }
      patch.isWorkspaceDefault = input.workspaceDefault;
    }

    const updated = await this.repository.updateIfRevision(id, input.expectedRevision, patch);
    if (updated === null) {
      // No row matched: either it vanished, or the revision moved on.
      const current = await this.repository.findById(id);
      if (current === null) throw new SavedViewNotFoundError(id);
      throw new SavedViewRevisionConflictError(id, input.expectedRevision);
    }

    if (updated.scope === 'shared') this.audit('updated', actor, updated);

    const [views, explicit] = await Promise.all([
      this.repository.listVisible(actor.userId, updated.pageKey),
      this.repository.findDefault(actor.userId, updated.pageKey),
    ]);
    return this.toReadModel(
      updated,
      actor,
      this.resolveDefaultId(views, explicit?.savedViewId, explicit !== null)
    );
  }

  async remove(actor: SavedViewActor, id: string): Promise<void> {
    const view = await this.requireWritable(actor, id);
    const deleted = await this.repository.delete(id);
    if (!deleted) throw new SavedViewNotFoundError(id);
    if (view.scope === 'shared') this.audit('deleted', actor, view);
  }

  async setDefault(actor: SavedViewActor, pageKey: string, viewId: string | null): Promise<void> {
    if (viewId === null) {
      await this.repository.upsertDefault(actor.userId, pageKey, null);
      return;
    }
    const view = await this.requireVisible(actor, viewId);
    if (view.pageKey !== pageKey) throw new SavedViewNotFoundError(viewId);
    await this.repository.upsertDefault(actor.userId, pageKey, viewId);
  }

  /** Visible = the caller's own personal view, or any shared view. Anything else is not found. */
  private async requireVisible(actor: SavedViewActor, id: string): Promise<SavedView> {
    const view = await this.repository.findById(id);
    if (view === null) throw new SavedViewNotFoundError(id);
    if (view.scope === 'personal' && view.ownerUserId !== actor.userId) {
      throw new SavedViewNotFoundError(id);
    }
    return view;
  }

  private async requireWritable(actor: SavedViewActor, id: string): Promise<SavedView> {
    const view = await this.requireVisible(actor, id);
    if (view.scope === 'shared') this.requireAdmin(actor);
    return view;
  }

  private requireAdmin(actor: SavedViewActor): void {
    if (!actor.isAdmin) throw new SavedViewForbiddenError();
  }

  private requireName(raw: unknown): string {
    const name = normaliseSavedViewName(raw);
    if (name === null) {
      throw new InvalidSavedViewError(
        'name',
        `name must be 1-${SAVED_VIEW_LIMITS.nameChars} characters`,
        'invalid-name',
        SAVED_VIEW_LIMITS.nameChars
      );
    }
    return name;
  }

  /** Shape and limits first, then the host's page-aware policy; returns what to persist. */
  private async requireDefinition(pageKey: string, raw: unknown): Promise<SavedViewDefinition> {
    const breach = checkSavedViewDefinition(raw);
    if (breach !== null) {
      throw new InvalidSavedViewError(breach.field, breach.message, breach.rule, breach.limit);
    }
    // `checkSavedViewDefinition` proved the shape, so the tolerant reader returns it verbatim.
    return this.definitionPolicy.normalise(pageKey, readSavedViewDefinition(raw).definition);
  }

  /** Shared views reach every user, so their changes leave a trail in the log. */
  private audit(action: string, actor: SavedViewActor, view: SavedView): void {
    this.logger.log(
      `shared saved view ${action}: id=${view.id} page=${view.pageKey} name="${view.name}" by=${actor.userId}`
    );
  }

  private resolveDefaultId(
    views: SavedView[],
    explicitViewId: string | null | undefined,
    hasExplicitRow: boolean
  ): string | null {
    if (hasExplicitRow) {
      if (explicitViewId === null || explicitViewId === undefined) return null;
      // A dangling pointer (the view was deleted or is no longer visible) falls
      // through to the next rung rather than erroring.
      if (views.some((view) => view.id === explicitViewId)) return explicitViewId;
    }
    return views.find((view) => view.scope === 'shared' && view.isWorkspaceDefault)?.id ?? null;
  }

  private toReadModel(
    view: SavedView,
    actor: SavedViewActor,
    defaultId: string | null
  ): SavedViewReadModel {
    const { definition, stale } = readSavedViewDefinition(view.definition);
    return {
      id: view.id,
      pageKey: view.pageKey,
      scope: view.scope,
      name: view.name,
      definition,
      stale,
      revision: view.revision,
      ownerUserId: view.ownerUserId,
      createdByUserId: view.createdByUserId,
      isWorkspaceDefault: view.isWorkspaceDefault,
      isDefault: view.id === defaultId,
      canEdit: view.scope === 'personal' ? view.ownerUserId === actor.userId : actor.isAdmin,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    };
  }
}
