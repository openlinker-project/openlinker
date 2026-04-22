/**
 * Content Draft Service
 *
 * Implements the draft write-through lifecycle for product content fields.
 * See `docs/plans/implementation-plan-338-340-content-and-ai-foundation.md`
 * §4.4 for the publish algorithm and §4.5 for the reconcile algorithm.
 *
 * @module libs/core/src/content/application/services
 * @implements {IContentDraftService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { ProductContentField } from '../../domain/entities/product-content-field.entity';
import { ContentConflictException } from '../../domain/exceptions/content-conflict.exception';
import {
  CONTENT_PUBLISHER_PORT_TOKEN,
  PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
} from '../../content.tokens';
import type { ContentPublisherPort } from '../../domain/ports/content-publisher.port';
import type { ProductContentFieldRepositoryPort } from '../../domain/ports/product-content-field-repository.port';
import type {
  DiscardDraftCommand,
  PublishDraftCommand,
  ReconcileExternalCommand,
  ResolveValueQuery,
  SaveDraftCommand,
} from '../types/content-draft.types';
import type { IContentDraftService } from './content-draft.service.interface';

@Injectable()
export class ContentDraftService implements IContentDraftService {
  private readonly logger = new Logger(ContentDraftService.name);

  constructor(
    @Inject(PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN)
    private readonly repository: ProductContentFieldRepositoryPort,
    @Inject(CONTENT_PUBLISHER_PORT_TOKEN)
    private readonly publisher: ContentPublisherPort,
  ) {}

  async saveDraft(cmd: SaveDraftCommand): Promise<ProductContentField> {
    const existing = await this.repository.findByKey({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
    });

    return this.repository.upsert({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
      draftValue: cmd.value,
      baseValue: existing?.baseValue ?? null,
      baseVersion: existing?.baseVersion ?? null,
      // Saving a draft implicitly acknowledges any prior conflict — the user is taking ownership.
      hasConflict: false,
      updatedBy: cmd.userId,
    });
  }

  async discardDraft(cmd: DiscardDraftCommand): Promise<void> {
    const existing = await this.repository.findByKey({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
    });

    if (!existing) {
      // No row → nothing to discard. Idempotent no-op.
      return;
    }

    if (existing.draftValue === null) {
      // Already no draft.
      return;
    }

    await this.repository.upsert({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
      draftValue: null,
      baseValue: existing.baseValue,
      baseVersion: existing.baseVersion,
      hasConflict: existing.hasConflict,
      updatedBy: existing.updatedBy,
    });
  }

  async publishDraft(cmd: PublishDraftCommand): Promise<ProductContentField> {
    const existing = await this.repository.findByKey({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
    });

    if (!existing || existing.draftValue === null) {
      // No-op publish: nothing to push. Return whatever the row currently looks like
      // (or fabricate an empty representation if absent — but absent + publish is unusual,
      // so we return the existing row to keep the contract simple).
      if (!existing) {
        // Not throwing here keeps publishDraft idempotent w.r.t. callers that don't
        // pre-check; if a stricter "must exist" semantic is wanted later, swap to
        // ContentFieldNotFoundException. For MVP, silently no-op preserves the
        // "draft buffer is the truth" mental model.
        this.logger.debug(
          `[content] publishDraft no-op (no row): productId=${cmd.productId} connectionId=${cmd.connectionId ?? 'master'} fieldKey=${cmd.fieldKey}`,
        );
      }
      return (
        existing ??
        new ProductContentField(
          'no-op',
          cmd.productId,
          cmd.connectionId,
          cmd.fieldKey,
          null,
          null,
          null,
          false,
          new Date(),
          null,
        )
      );
    }

    if (existing.hasConflict) {
      throw new ContentConflictException(cmd.productId, cmd.connectionId, cmd.fieldKey);
    }

    const publishResult = await this.publisher.publish({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
      value: existing.draftValue,
    });

    return this.repository.upsert({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
      draftValue: null,
      baseValue: existing.draftValue,
      baseVersion: publishResult.baseVersion,
      hasConflict: false,
      updatedBy: existing.updatedBy,
    });
  }

  async reconcileExternal(cmd: ReconcileExternalCommand): Promise<ProductContentField> {
    const existing = await this.repository.findByKey({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
    });

    if (!existing) {
      // First-touch: insert the base values silently, no draft, no conflict.
      return this.repository.upsert({
        productId: cmd.productId,
        connectionId: cmd.connectionId,
        fieldKey: cmd.fieldKey,
        draftValue: null,
        baseValue: cmd.externalValue,
        baseVersion: cmd.externalVersion,
        hasConflict: false,
        updatedBy: null, // system-driven
      });
    }

    const versionsMatch = existing.baseVersion === cmd.externalVersion;
    if (versionsMatch) {
      // Same-origin replay; nothing to do.
      return existing;
    }

    if (existing.draftValue === null) {
      // No draft pending → silent base refresh.
      return this.repository.upsert({
        productId: cmd.productId,
        connectionId: cmd.connectionId,
        fieldKey: cmd.fieldKey,
        draftValue: null,
        baseValue: cmd.externalValue,
        baseVersion: cmd.externalVersion,
        hasConflict: false,
        updatedBy: null,
      });
    }

    // Draft + divergence → mark conflict, advance the base, preserve the draft.
    this.logger.warn(
      `[content] conflict detected: productId=${cmd.productId} connectionId=${cmd.connectionId ?? 'master'} fieldKey=${cmd.fieldKey} ` +
        `baseVersion=${existing.baseVersion ?? '-'} externalVersion=${cmd.externalVersion}`,
    );
    return this.repository.upsert({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
      draftValue: existing.draftValue,
      baseValue: cmd.externalValue,
      baseVersion: cmd.externalVersion,
      hasConflict: true,
      updatedBy: existing.updatedBy,
    });
  }

  async resolveValue(query: ResolveValueQuery): Promise<string | null> {
    if (query.connectionId === null) {
      // Master-only resolution: master draft → master base → null.
      const master = await this.repository.findByKey({
        productId: query.productId,
        connectionId: null,
        fieldKey: query.fieldKey,
      });
      return master?.draftValue ?? master?.baseValue ?? null;
    }

    // Channel resolution with master fallback.
    const channel = await this.repository.findByKey({
      productId: query.productId,
      connectionId: query.connectionId,
      fieldKey: query.fieldKey,
    });
    const channelValue = channel?.draftValue ?? channel?.baseValue ?? null;
    if (channelValue !== null) {
      return channelValue;
    }

    const master = await this.repository.findByKey({
      productId: query.productId,
      connectionId: null,
      fieldKey: query.fieldKey,
    });
    return master?.draftValue ?? master?.baseValue ?? null;
  }
}
