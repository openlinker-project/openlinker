/**
 * Content Suggestion Service
 *
 * Composes `PromptTemplateService.render` + `AiCompletionPort.complete` to
 * produce an AI-authored description for a product (master or channel).
 * Never persists — acceptance routes back through
 * `ContentDraftService.saveDraft` at the controller level.
 *
 * The suggest call runs synchronously inside the HTTP handler. Anthropic
 * completions routinely take 2–10 s; the FE shows a "Thinking…" state until
 * the response lands. Upstream failures (`AiTimeoutError`, `AiRateLimitError`,
 * `AiInvalidResponseError`) propagate; the controller maps them to HTTP 502.
 *
 * @module libs/core/src/content/application/services
 * @implements {IContentSuggestionService}
 */
import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  AI_COMPLETION_PORT_TOKEN,
  PROMPT_TEMPLATE_SERVICE_TOKEN,
  type AiCompletionPort,
  type IPromptTemplateService,
} from '@openlinker/core/ai';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IIntegrationsService } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import { NoProductMasterAdapterException } from '../../domain/exceptions/no-product-master-adapter.exception';
import type {
  SuggestDescriptionCommand,
  SuggestionResult,
} from '../types/content-suggestion.types';
import { DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS } from '../types/content-suggestion.types';
import type { IContentSuggestionService } from './content-suggestion.service.interface';

const SUGGESTION_TEMPLATE_KEY = 'offer.description.suggest';

@Injectable()
export class ContentSuggestionService implements IContentSuggestionService {
  private readonly logger = new Logger(ContentSuggestionService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(PROMPT_TEMPLATE_SERVICE_TOKEN)
    private readonly promptTemplates: IPromptTemplateService,
    @Inject(AI_COMPLETION_PORT_TOKEN)
    private readonly ai: AiCompletionPort
  ) {}

  async suggestDescription(cmd: SuggestDescriptionCommand): Promise<SuggestionResult> {
    const requestId = cmd.requestId ?? randomUUID();

    const masters = await this.integrationsService.listCapabilityAdapters<ProductMasterPort>({
      capability: 'ProductMaster',
    });
    if (masters.length === 0) {
      throw new NoProductMasterAdapterException(cmd.productId, 'description');
    }
    // Same single-master simplification as `IntegrationsContentPublisher`. Refine
    // when multi-master wiring materialises; today there is at most one ProductMaster
    // per tenant in practice.
    const { adapter: productMaster } = masters[0];
    const product = await productMaster.getProduct(cmd.productId);
    const variants = await productMaster.getProductVariants(cmd.productId);
    const representativeVariant = variants[0] ?? null;

    // Latest published template for this (key, channel); throws if none exists.
    // The seeded v1 templates cover 'prestashop' and 'allegro'; a null channel
    // (master) has no seeded template today, and the service surface will fail
    // fast with the template-not-found exception in that branch.
    const rendered = await this.promptTemplates.render({
      key: SUGGESTION_TEMPLATE_KEY,
      channel: cmd.channel,
      values: {
        product: {
          name: product.name,
          attributes: representativeVariant?.attributes ?? {},
          category: product.categories?.[0] ?? '',
        },
        tone: cmd.tone ?? '',
        extraInstructions: cmd.extraInstructions ?? '',
      },
    });

    const completion = await this.ai.complete({
      systemPrompt: rendered.systemPrompt,
      userPrompt: rendered.userPrompt,
      cacheSystemPrompt: true,
      maxOutputTokens: cmd.maxOutputTokens ?? DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS,
      requestId,
    });

    this.logger.log(
      `[content-suggest] productId=${cmd.productId} channel=${cmd.channel ?? 'master'} ` +
        `templateKey=${SUGGESTION_TEMPLATE_KEY} templateVersion=${rendered.version} ` +
        `requestId=${requestId} model=${completion.modelUsed} latencyMs=${completion.latencyMs} ` +
        `inputTokens=${completion.usage.inputTokens} outputTokens=${completion.usage.outputTokens} ` +
        `cachedInputTokens=${completion.usage.cachedInputTokens}`
    );

    return {
      suggestion: completion.text,
      requestId,
      templateKey: SUGGESTION_TEMPLATE_KEY,
      templateVersion: rendered.version,
      templateChannel: cmd.channel,
      usage: completion.usage,
      modelUsed: completion.modelUsed,
      latencyMs: completion.latencyMs,
    };
  }
}
