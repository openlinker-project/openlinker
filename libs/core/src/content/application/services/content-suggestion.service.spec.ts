/**
 * Content Suggestion Service — Unit Tests
 *
 * Mocks `IIntegrationsService`, `IPromptTemplateService`, and
 * `AiCompletionPort` at the port level. Verifies:
 *   - product lookup → template render with the expected payload shape
 *   - AI call invoked with `cacheSystemPrompt: true` and the rendered prompts
 *   - result carries template version + usage + correlation requestId
 *   - no ProductMaster → NoProductMasterAdapterException
 *
 * @module libs/core/src/content/application/services
 */
import type { AiCompletionPort, IPromptTemplateService } from '@openlinker/core/ai';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import type { Product } from '@openlinker/core/products';
import type { ProductVariant } from '@openlinker/core/products';
import { NoProductMasterAdapterException } from '../../domain/exceptions/no-product-master-adapter.exception';
import { ContentSuggestionService } from './content-suggestion.service';

function buildProductMaster(args: {
  product: Partial<Product>;
  variants: ProductVariant[];
}): ProductMasterPort {
  return {
    getProduct: jest.fn().mockResolvedValue({
      id: 'ol_product_abc',
      name: 'Eco Wool Cap',
      sku: null,
      price: null,
      description: null,
      images: null,
      categories: ['Accessories'],
      ...args.product,
    } as Product),
    getProductVariants: jest.fn().mockResolvedValue(args.variants),
  } as unknown as ProductMasterPort;
}

describe('ContentSuggestionService', () => {
  it('should render the channel template with the product payload and call AI with cacheSystemPrompt', async () => {
    const productMaster = buildProductMaster({
      product: { name: 'Eco Wool Cap', categories: ['Accessories'] },
      variants: [
        { id: 'ol_variant_a', attributes: { color: 'red', size: 'M' } } as unknown as ProductVariant,
      ],
    });
    const integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>> = {
      listCapabilityAdapters: jest.fn().mockResolvedValue([
        { connectionId: 'conn-master', connection: {}, adapter: productMaster, metadata: {} },
      ]),
    };
    const prompts: jest.Mocked<Pick<IPromptTemplateService, 'render'>> = {
      render: jest.fn().mockResolvedValue({
        templateId: 'tmpl-allegro-1',
        version: 1,
        systemPrompt: 'sys',
        userPrompt: 'user',
      }),
    };
    const ai: jest.Mocked<AiCompletionPort> = {
      complete: jest.fn().mockResolvedValue({
        text: '<p>A warm cap.</p>',
        usage: { inputTokens: 120, outputTokens: 80, cachedInputTokens: 96 },
        modelUsed: 'claude-opus-4',
        latencyMs: 1234,
      }),
    };

    const service = new ContentSuggestionService(
      integrations as unknown as IIntegrationsService,
      prompts as unknown as IPromptTemplateService,
      ai,
    );

    const result = await service.suggestDescription({
      productId: 'ol_product_abc',
      channel: 'allegro',
      tone: 'casual',
      extraInstructions: 'use ≤ 120 words',
      requestId: 'req-123',
    });

    expect(prompts.render).toHaveBeenCalledWith({
      key: 'offer.description.suggest',
      channel: 'allegro',
      values: {
        product: {
          name: 'Eco Wool Cap',
          attributes: { color: 'red', size: 'M' },
          category: 'Accessories',
        },
        tone: 'casual',
        extraInstructions: 'use ≤ 120 words',
      },
    });
    expect(ai.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'sys',
        userPrompt: 'user',
        cacheSystemPrompt: true,
        maxOutputTokens: 1024,
        requestId: 'req-123',
      }),
    );
    expect(result.suggestion).toBe('<p>A warm cap.</p>');
    expect(result.requestId).toBe('req-123');
    expect(result.templateKey).toBe('offer.description.suggest');
    expect(result.templateVersion).toBe(1);
    expect(result.templateChannel).toBe('allegro');
    expect(result.usage.cachedInputTokens).toBe(96);
  });

  it('should generate a requestId when caller omits one', async () => {
    const productMaster = buildProductMaster({
      product: {},
      variants: [{ id: 'v' } as unknown as ProductVariant],
    });
    const integrations = {
      listCapabilityAdapters: jest.fn().mockResolvedValue([
        { connectionId: 'c', connection: {}, adapter: productMaster, metadata: {} },
      ]),
    } as unknown as IIntegrationsService;
    const prompts = {
      render: jest.fn().mockResolvedValue({
        templateId: 't',
        version: 1,
        systemPrompt: '',
        userPrompt: '',
      }),
    } as unknown as IPromptTemplateService;
    const ai: AiCompletionPort = {
      complete: jest.fn().mockResolvedValue({
        text: '',
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        modelUsed: 'm',
        latencyMs: 0,
      }),
    };
    const service = new ContentSuggestionService(integrations, prompts, ai);

    const result = await service.suggestDescription({ productId: 'p', channel: null });

    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should throw NoProductMasterAdapterException when no ProductMaster is registered', async () => {
    const integrations = {
      listCapabilityAdapters: jest.fn().mockResolvedValue([]),
    } as unknown as IIntegrationsService;
    const prompts = { render: jest.fn() } as unknown as IPromptTemplateService;
    const ai = { complete: jest.fn() } as unknown as AiCompletionPort;
    const service = new ContentSuggestionService(integrations, prompts, ai);

    await expect(
      service.suggestDescription({ productId: 'p', channel: 'prestashop' }),
    ).rejects.toBeInstanceOf(NoProductMasterAdapterException);
  });

  it('should pass empty tone / extraInstructions when caller omits them', async () => {
    const productMaster = buildProductMaster({
      product: {},
      variants: [{ id: 'v' } as unknown as ProductVariant],
    });
    const integrations = {
      listCapabilityAdapters: jest.fn().mockResolvedValue([
        { connectionId: 'c', connection: {}, adapter: productMaster, metadata: {} },
      ]),
    } as unknown as IIntegrationsService;
    const renderMock = jest.fn().mockResolvedValue({
      templateId: 't',
      version: 2,
      systemPrompt: 's',
      userPrompt: 'u',
    });
    const prompts = { render: renderMock } as unknown as IPromptTemplateService;
    const ai: AiCompletionPort = {
      complete: jest.fn().mockResolvedValue({
        text: 'x',
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        modelUsed: 'm',
        latencyMs: 0,
      }),
    };
    const service = new ContentSuggestionService(integrations, prompts, ai);

    await service.suggestDescription({ productId: 'p', channel: 'prestashop' });

    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({ tone: '', extraInstructions: '' }),
      }),
    );
  });
});
