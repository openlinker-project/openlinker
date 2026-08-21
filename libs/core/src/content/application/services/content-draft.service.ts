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
import { sanitizeStoredHtml } from '@openlinker/shared/html';
import { Logger } from '@openlinker/shared/logging';
import type { ProductContentField } from '../../domain/entities/product-content-field.entity';
import { ContentConflictException } from '../../domain/exceptions/content-conflict.exception';
import { ContentFieldNotFoundException } from '../../domain/exceptions/content-field-not-found.exception';
import {
  CONTENT_PUBLISHER_PORT_TOKEN,
  PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
} from '../../content.tokens';
import { ContentPublisherPort } from '../../domain/ports/content-publisher.port';
import { ProductContentFieldRepositoryPort } from '../../domain/ports/product-content-field-repository.port';
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
    private readonly publisher: ContentPublisherPort
  ) {}

  async saveDraft(cmd: SaveDraftCommand): Promise<ProductContentField> {
    const existing = await this.repository.findByKey({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
    });

    // #2198: the inbound XSS boundary. An operator-authored draft is untrusted
    // input the moment a surface renders it as HTML, and `RichTextView` does.
    // Deliberately wider than any destination format - narrowing per channel is
    // the publish path's job (ADR-046).
    const draftValue = sanitizeStoredHtml(cmd.value);
    if (draftValue !== cmd.value) {
      this.logger.warn(
        `[content] draft sanitized on save: productId=${cmd.productId} ` +
          `connectionId=${cmd.connectionId ?? 'master'} fieldKey=${cmd.fieldKey} ` +
          `before=${cmd.value.length}B after=${draftValue.length}B`
      );
    }

    return this.repository.upsert({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
      draftValue,
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

    if (!existing) {
      // Publishing requires a row to exist. Callers should saveDraft first.
      // We throw rather than silently no-op so a misuse (publish-before-save)
      // is surfaced rather than swallowed.
      throw new ContentFieldNotFoundException(cmd.productId, cmd.connectionId, cmd.fieldKey);
    }

    if (existing.draftValue === null) {
      // Row exists but no draft to publish — idempotent no-op, return as-is.
      this.logger.debug(
        `[content] publishDraft no-op (no draft): productId=${cmd.productId} connectionId=${cmd.connectionId ?? 'master'} fieldKey=${cmd.fieldKey}`
      );
      return existing;
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
    // #2198: `externalValue` is HTML read back from an external system, so it is
    // untrusted for exactly the same reason a master-supplied description is -
    // and `baseValue` IS rendered (the content panel falls back to it when no
    // draft exists). Sanitized once here rather than at each of the three
    // `upsert` calls below, so a fourth branch cannot be added without it.
    //
    // No production caller exists yet (inbound content reconcile is a documented
    // follow-up), which is precisely why this is worth closing now: the day that
    // pipeline is wired, the boundary is already complete rather than needing to
    // be remembered.
    const externalValue = sanitizeStoredHtml(cmd.externalValue);
    if (externalValue !== cmd.externalValue) {
      this.logger.warn(
        `[content] external value sanitized on reconcile: productId=${cmd.productId} ` +
          `connectionId=${cmd.connectionId ?? 'master'} fieldKey=${cmd.fieldKey}`
      );
    }

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
        baseValue: externalValue,
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
        baseValue: externalValue,
        baseVersion: cmd.externalVersion,
        hasConflict: false,
        updatedBy: null,
      });
    }

    // Draft + divergence → mark conflict, advance the base, preserve the draft.
    this.logger.warn(
      `[content] conflict detected: productId=${cmd.productId} connectionId=${cmd.connectionId ?? 'master'} fieldKey=${cmd.fieldKey} ` +
        `baseVersion=${existing.baseVersion ?? '-'} externalVersion=${cmd.externalVersion}`
    );
    return this.repository.upsert({
      productId: cmd.productId,
      connectionId: cmd.connectionId,
      fieldKey: cmd.fieldKey,
      draftValue: existing.draftValue,
      baseValue: externalValue,
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
